#define _GNU_SOURCE 1

#include <sys/prctl.h>
#include <unistd.h>

__attribute__((constructor)) static void agentmo_lock_dumpability(void) {
  if (prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0) _exit(126);
}
