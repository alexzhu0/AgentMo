#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#ifdef __linux__

#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>

#ifndef P_PIDFD
#define P_PIDFD 3
#endif

#define REPORT_FD 4
#define TARGET_RUNTIME_FD 6
#define TARGET_SCRIPT_FD 7
#ifndef AGENTMO_MAX_TRACKED
#define AGENTMO_MAX_TRACKED 4096
#endif
#define MAX_TRACKED AGENTMO_MAX_TRACKED
#ifndef AGENTMO_TEST_PIDFD_FAIL_AFTER
#define AGENTMO_TEST_PIDFD_FAIL_AFTER -1
#endif
#ifndef AGENTMO_TEST_CLOCK_FAIL_AFTER
#define AGENTMO_TEST_CLOCK_FAIL_AFTER -1
#endif
#define POLL_NS 10000000L
#define EMPTY_POLLS_REQUIRED 3
#define TERM_GRACE_MS 250
#define KILL_PROOF_MS 2000

#if defined(__x86_64__)
#define AGENTMO_AUDIT_ARCH AUDIT_ARCH_X86_64
#ifndef __X32_SYSCALL_BIT
#define __X32_SYSCALL_BIT 0x40000000U
#endif
#elif defined(__aarch64__)
#define AGENTMO_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#error "unsupported Linux architecture"
#endif

struct tracked_process {
  pid_t pid;
  int pidfd;
  bool alive;
};

static volatile sig_atomic_t g_shutdown_requested = 0;
static volatile sig_atomic_t g_output_limit = 0;
static size_t g_pidfd_open_attempts = 0;
static size_t g_clock_attempts = 0;

static void handle_term(int signal_number) {
  (void)signal_number;
  g_shutdown_requested = 1;
}

static void handle_output_limit(int signal_number) {
  (void)signal_number;
  g_output_limit = 1;
}

static int pidfd_open_exact(pid_t pid) {
#if AGENTMO_TEST_PIDFD_FAIL_AFTER == 0
  if (pid != getpid()) {
    errno = EMFILE;
    return -1;
  }
#elif AGENTMO_TEST_PIDFD_FAIL_AFTER > 0
  if (pid != getpid()
    && g_pidfd_open_attempts >= (size_t)AGENTMO_TEST_PIDFD_FAIL_AFTER) {
    errno = EMFILE;
    return -1;
  }
#endif
  if (pid != getpid()) g_pidfd_open_attempts += 1;
  return (int)syscall(SYS_pidfd_open, pid, 0U);
}

static int pidfd_signal_exact(int pidfd, int signal_number) {
  return (int)syscall(
    SYS_pidfd_send_signal,
    pidfd,
    signal_number,
    NULL,
    0U
  );
}

static bool install_process_group_lock(void) {
  struct sock_filter filter[] = {
    BPF_STMT(
      BPF_LD | BPF_W | BPF_ABS,
      (uint32_t)offsetof(struct seccomp_data, arch)
    ),
    BPF_JUMP(
      BPF_JMP | BPF_JEQ | BPF_K,
      AGENTMO_AUDIT_ARCH,
      1,
      0
    ),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(
      BPF_LD | BPF_W | BPF_ABS,
      (uint32_t)offsetof(struct seccomp_data, nr)
    ),
#if defined(__x86_64__)
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, __X32_SYSCALL_BIT),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)),
    BPF_STMT(
      BPF_LD | BPF_W | BPF_ABS,
      (uint32_t)offsetof(struct seccomp_data, nr)
    ),
#endif
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_setsid, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_setpgid, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_kill, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_tkill, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_tgkill, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_rt_sigqueueinfo, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_rt_tgsigqueueinfo, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_pidfd_send_signal, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_ptrace, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog program = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return false;
  return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) == 0;
}

static int64_t monotonic_milliseconds(void) {
#if AGENTMO_TEST_CLOCK_FAIL_AFTER == 0
  errno = EIO;
  return -1;
#elif AGENTMO_TEST_CLOCK_FAIL_AFTER > 0
  if (g_clock_attempts >= (size_t)AGENTMO_TEST_CLOCK_FAIL_AFTER) {
    errno = EIO;
    return -1;
  }
#endif
  g_clock_attempts += 1;
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
  return ((int64_t)now.tv_sec * 1000) + (now.tv_nsec / 1000000);
}

static bool write_control_byte(int fd, char value) {
  for (;;) {
    ssize_t written = write(fd, &value, 1U);
    if (written == 1) return true;
    if (written < 0 && errno == EINTR) continue;
    return false;
  }
}

static bool read_control_byte(int fd, char expected) {
  char value = '\0';
  for (;;) {
    ssize_t length = read(fd, &value, 1U);
    if (length == 1) return value == expected;
    if (length < 0 && errno == EINTR) continue;
    return false;
  }
}

static void abort_bootstrap(pid_t direct, int ready_fd, int go_fd) {
  if (ready_fd >= 0) close(ready_fd);
  if (go_fd >= 0) close(go_fd);
  (void)kill(-direct, SIGKILL);
  (void)kill(direct, SIGKILL);
  for (unsigned int attempt = 0; attempt < 250U; attempt += 1U) {
    pid_t waited = waitpid(direct, NULL, WNOHANG);
    if (waited == direct || (waited < 0 && errno == ECHILD)) return;
    if (waited < 0 && errno != EINTR) return;
    struct timespec interval = { .tv_sec = 0, .tv_nsec = POLL_NS };
    while (nanosleep(&interval, &interval) != 0 && errno == EINTR) {
    }
  }
}

static void sleep_poll(void) {
  struct timespec interval = { .tv_sec = 0, .tv_nsec = POLL_NS };
  while (nanosleep(&interval, &interval) != 0 && errno == EINTR) {
  }
}

static ssize_t tracked_index(
  const struct tracked_process *tracked,
  size_t count,
  pid_t pid
) {
  for (size_t index = 0; index < count; index += 1) {
    if (tracked[index].pid == pid) return (ssize_t)index;
  }
  return -1;
}

static bool add_tracked(
  struct tracked_process *tracked,
  size_t *count,
  pid_t pid
) {
  if (pid <= 0 || pid == getpid()) return true;
  if (tracked_index(tracked, *count, pid) >= 0) return true;
  if (*count >= MAX_TRACKED) return false;
  int pidfd = pidfd_open_exact(pid);
  if (pidfd < 0) {
    if (errno == ESRCH) return true;
    return false;
  }
  tracked[*count] = (struct tracked_process) {
    .pid = pid,
    .pidfd = pidfd,
    .alive = true,
  };
  *count += 1;
  return true;
}

static bool read_direct_children(
  pid_t parent,
  pid_t *children,
  size_t *child_count,
  size_t capacity
) {
  char proc_path[128];
  int written = snprintf(
    proc_path,
    sizeof(proc_path),
    "/proc/%ld/task/%ld/children",
    (long)parent,
    (long)parent
  );
  if (written <= 0 || (size_t)written >= sizeof(proc_path)) return false;
  int fd = open(proc_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) {
    if (errno == ENOENT || errno == ESRCH) return true;
    return false;
  }
  char buffer[65536];
  ssize_t length = read(fd, buffer, sizeof(buffer) - 1U);
  int saved_errno = errno;
  close(fd);
  if (length < 0) {
    errno = saved_errno;
    return false;
  }
  buffer[length] = '\0';
  char *cursor = buffer;
  while (*cursor != '\0') {
    while (*cursor == ' ' || *cursor == '\n' || *cursor == '\t') cursor += 1;
    if (*cursor == '\0') break;
    errno = 0;
    char *end = NULL;
    long parsed = strtol(cursor, &end, 10);
    if (errno != 0 || end == cursor || parsed <= 0 || parsed > INT32_MAX) {
      return false;
    }
    if (*child_count >= capacity) return false;
    children[*child_count] = (pid_t)parsed;
    *child_count += 1;
    cursor = end;
  }
  return true;
}

static bool discover_descendants(
  struct tracked_process *tracked,
  size_t *tracked_count,
  size_t *visible_count
) {
  pid_t queue[MAX_TRACKED];
  size_t queue_count = 0;
  size_t cursor = 0;
  queue[queue_count++] = getpid();
  *visible_count = 0;
  while (cursor < queue_count) {
    pid_t direct[MAX_TRACKED];
    size_t direct_count = 0;
    if (!read_direct_children(
      queue[cursor],
      direct,
      &direct_count,
      MAX_TRACKED
    )) return false;
    cursor += 1;
    for (size_t index = 0; index < direct_count; index += 1) {
      pid_t pid = direct[index];
      *visible_count += 1;
      if (!add_tracked(tracked, tracked_count, pid)) return false;
      bool queued = false;
      for (size_t seen = 0; seen < queue_count; seen += 1) {
        if (queue[seen] == pid) {
          queued = true;
          break;
        }
      }
      if (!queued) {
        if (queue_count >= MAX_TRACKED) return false;
        queue[queue_count++] = pid;
      }
    }
  }
  return true;
}

static void refresh_pidfds(
  struct tracked_process *tracked,
  size_t tracked_count
) {
  for (size_t index = 0; index < tracked_count; index += 1) {
    if (!tracked[index].alive) continue;
    siginfo_t info;
    memset(&info, 0, sizeof(info));
    int waited = waitid(
      P_PIDFD,
      (id_t)tracked[index].pidfd,
      &info,
      WEXITED | WNOHANG | WNOWAIT
    );
    if (waited == 0 && info.si_pid != 0) {
      tracked[index].alive = false;
      continue;
    }
    if (pidfd_signal_exact(tracked[index].pidfd, 0) != 0
      && errno == ESRCH) {
      tracked[index].alive = false;
    }
  }
}

static void compact_tracked(
  struct tracked_process *tracked,
  size_t *tracked_count
) {
  size_t next = 0;
  for (size_t index = 0; index < *tracked_count; index += 1) {
    if (!tracked[index].alive) {
      close(tracked[index].pidfd);
      continue;
    }
    if (next != index) tracked[next] = tracked[index];
    next += 1;
  }
  *tracked_count = next;
}

static bool any_alive(
  const struct tracked_process *tracked,
  size_t tracked_count
) {
  for (size_t index = 0; index < tracked_count; index += 1) {
    if (tracked[index].alive) return true;
  }
  return false;
}

static void signal_tracked(
  struct tracked_process *tracked,
  size_t tracked_count,
  int signal_number
) {
  for (size_t index = 0; index < tracked_count; index += 1) {
    if (!tracked[index].alive) continue;
    if (pidfd_signal_exact(tracked[index].pidfd, signal_number) != 0
      && errno == ESRCH) {
      tracked[index].alive = false;
    }
  }
}

static void reap_children(pid_t direct, bool *direct_closed, int *direct_status) {
  for (;;) {
    int status = 0;
    pid_t reaped = waitpid(-1, &status, WNOHANG);
    if (reaped <= 0) return;
    if (reaped == direct) {
      *direct_closed = true;
      *direct_status = status;
    }
  }
}

static int bounded_exit_code(bool direct_closed, int direct_status) {
  if (!direct_closed) return 1;
  if (WIFEXITED(direct_status)) return WEXITSTATUS(direct_status);
  if (WIFSIGNALED(direct_status)) return 128 + WTERMSIG(direct_status);
  return 1;
}

static void report_result(
  int exit_code,
  bool timed_out,
  bool output_limit,
  bool contained,
  bool quiescent,
  const char *failure_code
) {
  const char *failure = failure_code == NULL ? "null" : failure_code;
  if (failure_code == NULL) {
    dprintf(
      REPORT_FD,
      "{\"exitCode\":%d,\"timedOut\":%s,"
      "\"outputLimitExceeded\":%s,\"processStarted\":true,"
      "\"processGroupClosed\":%s,\"quiescenceVerified\":%s,"
      "\"containment\":\"linux-subreaper-pidfd-proc-children\","
      "\"failureCode\":null}\n",
      exit_code,
      timed_out ? "true" : "false",
      output_limit ? "true" : "false",
      contained ? "true" : "false",
      quiescent ? "true" : "false"
    );
  } else {
    dprintf(
      REPORT_FD,
      "{\"exitCode\":%d,\"timedOut\":%s,"
      "\"outputLimitExceeded\":%s,\"processStarted\":true,"
      "\"processGroupClosed\":%s,\"quiescenceVerified\":%s,"
      "\"containment\":\"linux-subreaper-pidfd-proc-children\","
      "\"failureCode\":\"%s\"}\n",
      exit_code,
      timed_out ? "true" : "false",
      output_limit ? "true" : "false",
      contained ? "true" : "false",
      quiescent ? "true" : "false",
      failure
    );
  }
}

static bool parse_timeout(const char *value, int64_t *timeout_ms) {
  errno = 0;
  char *end = NULL;
  long long parsed = strtoll(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed <= 0
    || parsed > 3600000) return false;
  *timeout_ms = (int64_t)parsed;
  return true;
}

int main(int argc, char **argv) {
  if (argc < 5 || strcmp(argv[1], "--timeout-ms") != 0
    || strcmp(argv[3], "--") != 0 || fcntl(REPORT_FD, F_GETFD) < 0
    || fcntl(TARGET_RUNTIME_FD, F_GETFD) < 0
    || fcntl(TARGET_SCRIPT_FD, F_GETFD) < 0
    || argc < 6 || strcmp(argv[5], "/proc/self/fd/7") != 0) {
    return 64;
  }
  int64_t timeout_ms = 0;
  if (!parse_timeout(argv[2], &timeout_ms)) return 64;
  int self_pidfd = pidfd_open_exact(getpid());
  if (self_pidfd < 0) return 78;
  siginfo_t self_info;
  memset(&self_info, 0, sizeof(self_info));
  if (waitid(P_PIDFD, (id_t)self_pidfd, &self_info, WEXITED | WNOHANG) != -1
    || errno != ECHILD) {
    close(self_pidfd);
    return 78;
  }
  close(self_pidfd);
  pid_t initial_children[MAX_TRACKED];
  size_t initial_child_count = 0;
  if (!read_direct_children(
    getpid(),
    initial_children,
    &initial_child_count,
    MAX_TRACKED
  ) || initial_child_count != 0) return 78;
  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0
    || prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0) return 78;

  struct sigaction terminate_action;
  memset(&terminate_action, 0, sizeof(terminate_action));
  terminate_action.sa_handler = handle_term;
  sigemptyset(&terminate_action.sa_mask);
  if (sigaction(SIGTERM, &terminate_action, NULL) != 0) return 78;
  struct sigaction output_action;
  memset(&output_action, 0, sizeof(output_action));
  output_action.sa_handler = handle_output_limit;
  sigemptyset(&output_action.sa_mask);
  if (sigaction(SIGUSR1, &output_action, NULL) != 0) return 78;
  struct sigaction pipe_action;
  memset(&pipe_action, 0, sizeof(pipe_action));
  pipe_action.sa_handler = SIG_IGN;
  sigemptyset(&pipe_action.sa_mask);
  if (sigaction(SIGPIPE, &pipe_action, NULL) != 0) return 78;

  int bootstrap_ready[2];
  int bootstrap_go[2];
  if (pipe2(bootstrap_ready, O_CLOEXEC) != 0) return 78;
  if (pipe2(bootstrap_go, O_CLOEXEC) != 0) {
    close(bootstrap_ready[0]);
    close(bootstrap_ready[1]);
    return 78;
  }

  pid_t direct = fork();
  if (direct < 0) {
    close(bootstrap_ready[0]);
    close(bootstrap_ready[1]);
    close(bootstrap_go[0]);
    close(bootstrap_go[1]);
    return 70;
  }
  if (direct == 0) {
    close(bootstrap_ready[0]);
    close(bootstrap_go[1]);
    close(REPORT_FD);
    if (setpgid(0, 0) != 0 || !install_process_group_lock()) _exit(126);
    if (!write_control_byte(bootstrap_ready[1], 'R')) _exit(126);
    close(bootstrap_ready[1]);
    if (!read_control_byte(bootstrap_go[0], 'G')) _exit(126);
    close(bootstrap_go[0]);
    execveat(TARGET_RUNTIME_FD, "", &argv[4], environ, AT_EMPTY_PATH);
    _exit(127);
  }
  close(bootstrap_ready[1]);
  close(bootstrap_go[0]);
  if (setpgid(direct, direct) != 0
    || !read_control_byte(bootstrap_ready[0], 'R')) {
    abort_bootstrap(direct, bootstrap_ready[0], bootstrap_go[1]);
    return 78;
  }
  close(bootstrap_ready[0]);
  struct tracked_process tracked[MAX_TRACKED];
  size_t tracked_count = 0;
  if (!add_tracked(tracked, &tracked_count, direct) || tracked_count != 1) {
    abort_bootstrap(direct, -1, bootstrap_go[1]);
    return 78;
  }

  int64_t started_at = monotonic_milliseconds();
  if (started_at < 0) {
    close(tracked[0].pidfd);
    abort_bootstrap(direct, -1, bootstrap_go[1]);
    return 78;
  }
  if (!write_control_byte(bootstrap_go[1], 'G')) {
    close(tracked[0].pidfd);
    abort_bootstrap(direct, -1, bootstrap_go[1]);
    return 78;
  }
  close(bootstrap_go[1]);
  bool direct_closed = false;
  int direct_status = 0;
  bool shutdown = false;
  bool sent_kill = false;
  bool timed_out = false;
  bool output_limit = false;
  bool containment_error = false;
  bool descendant_outlived = false;
  int64_t shutdown_at = 0;
  unsigned int empty_polls = 0;

  for (;;) {
    reap_children(direct, &direct_closed, &direct_status);
    refresh_pidfds(tracked, tracked_count);
    compact_tracked(tracked, &tracked_count);
    size_t visible_count = 0;
    if (!discover_descendants(tracked, &tracked_count, &visible_count)) {
      containment_error = true;
      shutdown = true;
    }
    refresh_pidfds(tracked, tracked_count);
    compact_tracked(tracked, &tracked_count);
    int64_t now = monotonic_milliseconds();
    if (now < 0) {
      containment_error = true;
      shutdown = true;
    }
    if (!shutdown && g_output_limit != 0) {
      output_limit = true;
      shutdown = true;
    }
    if (!shutdown && g_shutdown_requested != 0) shutdown = true;
    if (!shutdown && now - started_at >= timeout_ms) {
      timed_out = true;
      shutdown = true;
    }
    if (!shutdown && direct_closed && (visible_count > 0
      || any_alive(tracked, tracked_count))) {
      descendant_outlived = true;
      shutdown = true;
    }
    if (shutdown && shutdown_at == 0) {
      shutdown_at = now;
      signal_tracked(tracked, tracked_count, SIGTERM);
      (void)kill(-direct, SIGTERM);
    }
    if (shutdown && !sent_kill && now - shutdown_at >= TERM_GRACE_MS) {
      sent_kill = true;
      signal_tracked(tracked, tracked_count, SIGKILL);
      (void)kill(-direct, SIGKILL);
    }
    if (shutdown) {
      signal_tracked(
        tracked,
        tracked_count,
        sent_kill ? SIGKILL : SIGTERM
      );
    }
    if (visible_count == 0 && !any_alive(tracked, tracked_count)
      && direct_closed) {
      empty_polls += 1;
    } else {
      empty_polls = 0;
    }
    if (empty_polls >= EMPTY_POLLS_REQUIRED) {
      int direct_exit = bounded_exit_code(direct_closed, direct_status);
      const char *failure = NULL;
      if (containment_error) failure = "containment-proof-failed";
      else if (output_limit) failure = "output-limit-exceeded";
      else if (timed_out) failure = "timeout";
      else if (g_shutdown_requested != 0) failure = "supervisor-interrupted";
      else if (descendant_outlived) failure = "descendant-outlived-parent";
      else if (direct_exit != 0) failure = "command-failed";
      report_result(
        timed_out ? 124 : direct_exit,
        timed_out,
        output_limit,
        true,
        true,
        failure
      );
      break;
    }
    if (shutdown && sent_kill && now - shutdown_at >= KILL_PROOF_MS) {
      report_result(
        timed_out ? 124 : 1,
        timed_out,
        output_limit,
        false,
        false,
        "descendant-unreapable"
      );
      break;
    }
    sleep_poll();
  }
  for (size_t index = 0; index < tracked_count; index += 1) {
    close(tracked[index].pidfd);
  }
  return 0;
}

#else

int main(void) {
  return 78;
}

#endif
