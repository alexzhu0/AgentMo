#define _DARWIN_C_SOURCE 1
#define _GNU_SOURCE 1

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#if defined(__linux__)
#include <sys/syscall.h>
#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1U << 0)
#endif
#endif

#define MAX_LINE_BYTES (64U * 1024U)
#define MAX_CONTENT_BYTES (1024U * 1024U)
#define MAX_FIELDS 12
#define MAX_KEY_BYTES 48
#define MAX_VALUE_BYTES ((MAX_CONTENT_BYTES * 4U / 3U) + 16U)
#define MAX_COMPONENT_BYTES 255

typedef struct {
  char key[MAX_KEY_BYTES];
  char *value;
} field_t;

typedef struct {
  uint32_t state[8];
  uint64_t bit_count;
  uint8_t block[64];
  size_t used;
} sha256_ctx;

static int root_fd = -1;
static dev_t root_device = 0;
static int reservation_fd = -1;
static int reservation_parent_fd = -1;
static char reservation_path[MAX_LINE_BYTES + 1];
static char reservation_base[MAX_COMPONENT_BYTES + 1];
static struct stat reservation_identity;

static uint32_t rotr32(uint32_t value, unsigned shift) {
  return (value >> shift) | (value << (32U - shift));
}

static void sha256_transform(sha256_ctx *ctx, const uint8_t block[64]) {
  static const uint32_t constants[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
    0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
    0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
    0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
    0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
    0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
    0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
    0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
    0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
    0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
    0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
    0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
  };
  uint32_t words[64];
  uint32_t a, b, c, d, e, f, g, h;
  size_t index;
  for (index = 0; index < 16; index += 1) {
    size_t offset = index * 4;
    words[index] = ((uint32_t)block[offset] << 24)
      | ((uint32_t)block[offset + 1] << 16)
      | ((uint32_t)block[offset + 2] << 8)
      | (uint32_t)block[offset + 3];
  }
  for (index = 16; index < 64; index += 1) {
    uint32_t s0 = rotr32(words[index - 15], 7)
      ^ rotr32(words[index - 15], 18)
      ^ (words[index - 15] >> 3);
    uint32_t s1 = rotr32(words[index - 2], 17)
      ^ rotr32(words[index - 2], 19)
      ^ (words[index - 2] >> 10);
    words[index] = words[index - 16] + s0 + words[index - 7] + s1;
  }
  a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
  e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];
  for (index = 0; index < 64; index += 1) {
    uint32_t s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t choose = (e & f) ^ ((~e) & g);
    uint32_t t1 = h + s1 + choose + constants[index] + words[index];
    uint32_t s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = s0 + majority;
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
  ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void sha256_init(sha256_ctx *ctx) {
  static const uint32_t initial[8] = {
    0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
    0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U,
  };
  memcpy(ctx->state, initial, sizeof(initial));
  ctx->bit_count = 0;
  ctx->used = 0;
}

static void sha256_update(sha256_ctx *ctx, const uint8_t *bytes, size_t length) {
  size_t offset = 0;
  ctx->bit_count += (uint64_t)length * 8U;
  while (offset < length) {
    size_t available = 64U - ctx->used;
    size_t take = length - offset < available ? length - offset : available;
    memcpy(ctx->block + ctx->used, bytes + offset, take);
    ctx->used += take;
    offset += take;
    if (ctx->used == 64U) {
      sha256_transform(ctx, ctx->block);
      ctx->used = 0;
    }
  }
}

static void sha256_final(sha256_ctx *ctx, uint8_t digest[32]) {
  size_t index;
  ctx->block[ctx->used++] = 0x80U;
  if (ctx->used > 56U) {
    while (ctx->used < 64U) ctx->block[ctx->used++] = 0;
    sha256_transform(ctx, ctx->block);
    ctx->used = 0;
  }
  while (ctx->used < 56U) ctx->block[ctx->used++] = 0;
  for (index = 0; index < 8U; index += 1) {
    ctx->block[63U - index] = (uint8_t)(ctx->bit_count >> (index * 8U));
  }
  sha256_transform(ctx, ctx->block);
  for (index = 0; index < 8U; index += 1) {
    digest[index * 4U] = (uint8_t)(ctx->state[index] >> 24);
    digest[index * 4U + 1U] = (uint8_t)(ctx->state[index] >> 16);
    digest[index * 4U + 2U] = (uint8_t)(ctx->state[index] >> 8);
    digest[index * 4U + 3U] = (uint8_t)ctx->state[index];
  }
}

static void digest_hex(const uint8_t *bytes, size_t length, char output[72]) {
  static const char alphabet[] = "0123456789abcdef";
  sha256_ctx ctx;
  uint8_t digest[32];
  size_t index;
  sha256_init(&ctx);
  sha256_update(&ctx, bytes, length);
  sha256_final(&ctx, digest);
  memcpy(output, "sha256:", 7);
  for (index = 0; index < 32; index += 1) {
    output[7 + index * 2] = alphabet[digest[index] >> 4];
    output[8 + index * 2] = alphabet[digest[index] & 15U];
  }
  output[71] = '\0';
}

static void protocol_failure(void) {
  fputs("{\"ok\":false,\"code\":\"AGENTMO_OPENCLAW_FS_PROTOCOL_REJECTED\"}\n", stdout);
  fflush(stdout);
}

static void preserved(const char *reason) {
  printf("{\"ok\":true,\"disposition\":\"preserved\",\"reason\":\"%s\"}\n", reason);
  fflush(stdout);
}

static void free_fields(field_t fields[MAX_FIELDS], size_t count) {
  size_t index;
  for (index = 0; index < count; index += 1) free(fields[index].value);
}

static int parse_string(const char **cursor, char *output, size_t capacity) {
  size_t used = 0;
  if (**cursor != '"') return -1;
  *cursor += 1;
  while (**cursor != '\0' && **cursor != '"') {
    unsigned char value = (unsigned char)**cursor;
    if (value < 0x20U || value == '\\') return -1;
    if (used + 1 >= capacity) return -1;
    output[used++] = (char)value;
    *cursor += 1;
  }
  if (**cursor != '"') return -1;
  *cursor += 1;
  output[used] = '\0';
  return 0;
}

static void skip_space(const char **cursor) {
  while (**cursor == ' ' || **cursor == '\t' || **cursor == '\r') *cursor += 1;
}

static int parse_object(char *line, field_t fields[MAX_FIELDS], size_t *count) {
  const char *cursor = line;
  size_t used = 0;
  skip_space(&cursor);
  if (*cursor++ != '{') return -1;
  skip_space(&cursor);
  while (*cursor != '}') {
    char key[MAX_KEY_BYTES];
    char *value = malloc(MAX_VALUE_BYTES);
    size_t index;
    if (used >= MAX_FIELDS || value == NULL) {
      free(value);
      free_fields(fields, used);
      return -1;
    }
    if (parse_string(&cursor, key, sizeof(key)) != 0) {
      free(value); free_fields(fields, used); return -1;
    }
    for (index = 0; index < used; index += 1) {
      if (strcmp(fields[index].key, key) == 0) {
        free(value); free_fields(fields, used); return -1;
      }
    }
    skip_space(&cursor);
    if (*cursor++ != ':') {
      free(value); free_fields(fields, used); return -1;
    }
    skip_space(&cursor);
    if (parse_string(&cursor, value, MAX_VALUE_BYTES) != 0) {
      free(value); free_fields(fields, used); return -1;
    }
    strcpy(fields[used].key, key);
    fields[used].value = value;
    used += 1;
    skip_space(&cursor);
    if (*cursor == ',') {
      cursor += 1;
      skip_space(&cursor);
      continue;
    }
    if (*cursor != '}') {
      free_fields(fields, used); return -1;
    }
  }
  cursor += 1;
  skip_space(&cursor);
  if (*cursor != '\0') {
    free_fields(fields, used); return -1;
  }
  *count = used;
  return 0;
}

static const char *field_value(field_t fields[MAX_FIELDS], size_t count, const char *key) {
  size_t index;
  for (index = 0; index < count; index += 1) {
    if (strcmp(fields[index].key, key) == 0) return fields[index].value;
  }
  return NULL;
}

static int exact_keys(field_t fields[MAX_FIELDS], size_t count, const char **keys, size_t expected) {
  size_t index;
  if (count != expected) return 0;
  for (index = 0; index < expected; index += 1) {
    if (field_value(fields, count, keys[index]) == NULL) return 0;
  }
  return 1;
}

static int valid_relative_path(const char *value) {
  const char *cursor = value;
  size_t component = 0;
  if (value == NULL || value[0] == '\0' || value[0] == '/') return 0;
  while (*cursor != '\0') {
    if (*cursor == '\\' || (unsigned char)*cursor < 0x20U) return 0;
    if (*cursor == '/') {
      if (component == 0) return 0;
      component = 0;
    } else {
      component += 1;
      if (component > MAX_COMPONENT_BYTES) return 0;
    }
    cursor += 1;
  }
  if (component == 0) return 0;
  cursor = value;
  while (*cursor != '\0') {
    const char *slash = strchr(cursor, '/');
    size_t length = slash == NULL ? strlen(cursor) : (size_t)(slash - cursor);
    if ((length == 1 && cursor[0] == '.')
      || (length == 2 && cursor[0] == '.' && cursor[1] == '.')) return 0;
    if (slash == NULL) break;
    cursor = slash + 1;
  }
  return 1;
}

static int safe_directory(const struct stat *stats, int require_current_uid) {
  uid_t uid = getuid();
  if (!S_ISDIR(stats->st_mode) || (stats->st_mode & 0022) != 0) return 0;
  if (require_current_uid) return stats->st_uid == uid;
  return stats->st_uid == uid || stats->st_uid == 0;
}

static int open_parent(const char *relative, char base[MAX_COMPONENT_BYTES + 1]) {
  char *copy;
  char *cursor;
  int current;
  if (!valid_relative_path(relative) || root_fd < 0) return -1;
  copy = strdup(relative);
  if (copy == NULL) return -1;
  current = dup(root_fd);
  if (current < 0) {
    free(copy);
    return -1;
  }
  cursor = copy;
  while (1) {
    char *slash = strchr(cursor, '/');
    if (slash == NULL) {
      strcpy(base, cursor);
      break;
    }
    struct stat stats;
    int next;
    *slash = '\0';
    next = openat(current, cursor, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0 || fstat(next, &stats) != 0
      || !safe_directory(&stats, 1)
      || stats.st_dev != root_device) {
      if (next >= 0) close(next);
      close(current);
      free(copy);
      return -1;
    }
    close(current);
    current = next;
    cursor = slash + 1;
  }
  free(copy);
  return current;
}

static int decode_base64(const char *input, uint8_t **output, size_t *length) {
  static const signed char table[256] = {
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
    52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-2,-1,-1,
    -1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,
    15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
    -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
    41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1
  };
  size_t input_length = strlen(input);
  size_t index;
  size_t used = 0;
  uint32_t accumulator = 0;
  unsigned bits = 0;
  uint8_t *bytes;
  if (input_length == 0 || input_length % 4 != 0
    || input_length > ((MAX_CONTENT_BYTES + 2U) / 3U) * 4U) return -1;
  bytes = malloc((input_length / 4U) * 3U);
  if (bytes == NULL) return -1;
  for (index = 0; index < input_length; index += 1) {
    unsigned char character = (unsigned char)input[index];
    int value = character < 128U ? table[character] : -1;
    if (value == -2) {
      size_t remaining = input_length - index;
      if (remaining > 2U || input[input_length - 1U] != '=') {
        free(bytes); return -1;
      }
      break;
    }
    if (value < 0) {
      free(bytes); return -1;
    }
    accumulator = (accumulator << 6) | (uint32_t)value;
    bits += 6U;
    if (bits >= 8U) {
      bits -= 8U;
      bytes[used++] = (uint8_t)(accumulator >> bits);
      accumulator &= bits == 0 ? 0U : ((1U << bits) - 1U);
    }
  }
  if (used > MAX_CONTENT_BYTES) {
    free(bytes); return -1;
  }
  *output = bytes;
  *length = used;
  return 0;
}

static int write_all(int descriptor, const uint8_t *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(descriptor, bytes + offset, length - offset);
    if (written <= 0) return -1;
    offset += (size_t)written;
  }
  return 0;
}

static int digest_descriptor(
  int descriptor,
  off_t expected_size,
  char output[72]
) {
  sha256_ctx ctx;
  uint8_t buffer[16U * 1024U];
  off_t remaining = expected_size;
  if (expected_size < 0 || expected_size > (off_t)MAX_CONTENT_BYTES
    || lseek(descriptor, 0, SEEK_SET) < 0) return -1;
  sha256_init(&ctx);
  while (remaining > 0) {
    size_t requested = remaining < (off_t)sizeof(buffer)
      ? (size_t)remaining
      : sizeof(buffer);
    ssize_t count = read(descriptor, buffer, requested);
    if (count <= 0) return -1;
    sha256_update(&ctx, buffer, (size_t)count);
    remaining -= count;
  }
  {
    uint8_t extra;
    if (read(descriptor, &extra, 1U) != 0) return -1;
  }
  {
    static const char alphabet[] = "0123456789abcdef";
    uint8_t digest[32];
    size_t index;
    sha256_final(&ctx, digest);
    memcpy(output, "sha256:", 7);
    for (index = 0; index < 32; index += 1) {
      output[7 + index * 2] = alphabet[digest[index] >> 4];
      output[8 + index * 2] = alphabet[digest[index] & 15U];
    }
    output[71] = '\0';
  }
  return 0;
}

static int same_file_snapshot(
  const struct stat *left,
  const struct stat *right
) {
  return left->st_dev == right->st_dev
    && left->st_ino == right->st_ino
    && left->st_mode == right->st_mode
    && left->st_uid == right->st_uid
    && left->st_nlink == right->st_nlink
    && left->st_size == right->st_size
    && left->st_mtime == right->st_mtime
    && left->st_ctime == right->st_ctime;
}

static int same_exact_regular_file(
  const struct stat *value,
  const struct stat *expected
) {
  return S_ISREG(value->st_mode)
    && value->st_dev == expected->st_dev
    && value->st_ino == expected->st_ino
    && value->st_uid == expected->st_uid
    && (value->st_mode & 0777) == (expected->st_mode & 0777)
    && value->st_nlink == 1;
}

static int decimal_text(const char *value) {
  const unsigned char *cursor = (const unsigned char *)value;
  if (cursor == NULL || *cursor == '\0') return 0;
  while (*cursor != '\0') {
    if (*cursor < '0' || *cursor > '9') return 0;
    cursor += 1;
  }
  return 1;
}

static int mode_text(const char *value) {
  size_t length;
  const unsigned char *cursor = (const unsigned char *)value;
  if (cursor == NULL) return 0;
  length = strlen(value);
  if (length < 3U || length > 4U) return 0;
  while (*cursor != '\0') {
    if (*cursor < '0' || *cursor > '7') return 0;
    cursor += 1;
  }
  return 1;
}

static int digest_text(const char *value) {
  size_t index;
  if (value == NULL || strlen(value) != 71U
    || strncmp(value, "sha256:", 7U) != 0) return 0;
  for (index = 7U; index < 71U; index += 1) {
    if (!((value[index] >= '0' && value[index] <= '9')
      || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  }
  return 1;
}

static int publish_no_replace(int source_dirfd, const char *source,
  int destination_dirfd, const char *destination) {
#if defined(__linux__)
  return (int)syscall(
    SYS_renameat2,
    source_dirfd,
    source,
    destination_dirfd,
    destination,
    RENAME_NOREPLACE
  );
#elif defined(__APPLE__)
  return renameatx_np(
    source_dirfd,
    source,
    destination_dirfd,
    destination,
    RENAME_EXCL
  );
#else
  errno = ENOTSUP;
  return -1;
#endif
}

static int handle_publish_no_replace(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {
    "operation",
    "sourcePath",
    "destinationPath",
    "sourceDevice",
    "sourceInode",
    "sourceType",
  };
  const char *source_path;
  const char *destination_path;
  const char *expected_device;
  const char *expected_inode;
  const char *expected_type;
  const char *actual_type;
  char source_base[MAX_COMPONENT_BYTES + 1];
  char destination_base[MAX_COMPONENT_BYTES + 1];
  char actual_device[32];
  char actual_inode[32];
  struct stat before;
  struct stat after;
  int source_parent;
  int destination_parent;
  int is_file;
  int is_directory;
  if (!exact_keys(fields, count, keys, 6)
    || strcmp(
      field_value(fields, count, "operation"),
      "publish-no-replace"
    ) != 0) return -1;
  source_path = field_value(fields, count, "sourcePath");
  destination_path = field_value(fields, count, "destinationPath");
  expected_device = field_value(fields, count, "sourceDevice");
  expected_inode = field_value(fields, count, "sourceInode");
  expected_type = field_value(fields, count, "sourceType");
  if (strcmp(source_path, destination_path) == 0
    || (strcmp(expected_type, "file") != 0
      && strcmp(expected_type, "directory") != 0)) return -1;
  source_parent = open_parent(source_path, source_base);
  if (source_parent < 0) {
    preserved("unsafe-source-ancestor");
    return 0;
  }
  destination_parent = open_parent(destination_path, destination_base);
  if (destination_parent < 0) {
    close(source_parent);
    preserved("unsafe-destination-ancestor");
    return 0;
  }
  if (fstatat(
      source_parent,
      source_base,
      &before,
      AT_SYMLINK_NOFOLLOW
    ) != 0) {
    close(destination_parent);
    close(source_parent);
    preserved("source-observation-failed");
    return 0;
  }
  snprintf(actual_device, sizeof(actual_device), "%llu",
    (unsigned long long)before.st_dev);
  snprintf(actual_inode, sizeof(actual_inode), "%llu",
    (unsigned long long)before.st_ino);
  is_file = S_ISREG(before.st_mode);
  is_directory = S_ISDIR(before.st_mode);
  actual_type = is_file ? "file" : is_directory ? "directory" : "unsupported";
  if (strcmp(actual_device, expected_device) != 0
    || strcmp(actual_inode, expected_inode) != 0
    || strcmp(actual_type, expected_type) != 0
    || before.st_uid != getuid()
    || (before.st_mode & 0022) != 0
    || (is_file && before.st_nlink != 1)
    || before.st_dev != root_device) {
    close(destination_parent);
    close(source_parent);
    preserved("source-identity-mismatch");
    return 0;
  }
  if (fsync(source_parent) != 0) {
    close(destination_parent);
    close(source_parent);
    preserved("source-durability-unknown");
    return 0;
  }
  if (publish_no_replace(
      source_parent,
      source_base,
      destination_parent,
      destination_base
    ) != 0) {
    int saved = errno;
    close(destination_parent);
    close(source_parent);
    if (saved == EEXIST || saved == ENOTEMPTY || saved == ELOOP) {
      preserved("destination-exists");
      return 0;
    }
    preserved("publication-refused");
    return 0;
  }
  if (fsync(source_parent) != 0
    || fsync(destination_parent) != 0
    || fstatat(
      destination_parent,
      destination_base,
      &after,
      AT_SYMLINK_NOFOLLOW
    ) != 0
    || before.st_dev != after.st_dev
    || before.st_ino != after.st_ino
    || (is_file && !S_ISREG(after.st_mode))
    || (is_directory && !S_ISDIR(after.st_mode))) {
    close(destination_parent);
    close(source_parent);
    printf("{\"ok\":true,\"disposition\":\"preserved\","
      "\"reason\":\"post-publication-unknown\",\"sourceConsumed\":true,"
      "\"device\":\"%s\",\"inode\":\"%s\",\"type\":\"%s\"}\n",
      actual_device, actual_inode, actual_type);
    fflush(stdout);
    return 0;
  }
  close(destination_parent);
  close(source_parent);
  printf("{\"ok\":true,\"disposition\":\"published\","
    "\"device\":\"%s\",\"inode\":\"%s\",\"type\":\"%s\"}\n",
    actual_device, actual_inode, actual_type);
  fflush(stdout);
  return 0;
}

static int handle_open(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {"operation", "rootPath", "device", "inode"};
  const char *root_path;
  const char *device;
  const char *inode;
  struct stat stats;
  char actual_device[32];
  char actual_inode[32];
  int descriptor;
  if (!exact_keys(fields, count, keys, 4)
    || strcmp(field_value(fields, count, "operation"), "open") != 0) return -1;
  root_path = field_value(fields, count, "rootPath");
  device = field_value(fields, count, "device");
  inode = field_value(fields, count, "inode");
  if (root_path == NULL || root_path[0] != '/') return -1;
  descriptor = open(root_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor < 0 || fstat(descriptor, &stats) != 0 || !safe_directory(&stats, 1)) {
    if (descriptor >= 0) close(descriptor);
    preserved("unsafe-root");
    return 0;
  }
  snprintf(actual_device, sizeof(actual_device), "%llu", (unsigned long long)stats.st_dev);
  snprintf(actual_inode, sizeof(actual_inode), "%llu", (unsigned long long)stats.st_ino);
  if (strcmp(actual_device, device) != 0 || strcmp(actual_inode, inode) != 0) {
    close(descriptor);
    preserved("root-identity-mismatch");
    return 0;
  }
  root_fd = descriptor;
  root_device = stats.st_dev;
  printf("{\"ok\":true,\"disposition\":\"opened\",\"device\":\"%s\",\"inode\":\"%s\"}\n",
    actual_device, actual_inode);
  fflush(stdout);
  return 0;
}

static int handle_observe(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {"operation", "path"};
  const char *relative;
  char base[MAX_COMPONENT_BYTES + 1];
  char digest[72];
  char device[32], inode[32], mode[16], uid[32], size[32];
  char parent_device[32], parent_inode[32];
  struct stat before, after, parent_stats;
  uint8_t *bytes;
  int parent;
  int descriptor;
  ssize_t offset = 0;
  if (!exact_keys(fields, count, keys, 2)
    || strcmp(field_value(fields, count, "operation"), "observe") != 0) return -1;
  relative = field_value(fields, count, "path");
  parent = open_parent(relative, base);
  if (parent < 0) {
    preserved("unsafe-ancestor");
    return 0;
  }
  if (fstat(parent, &parent_stats) != 0) {
    close(parent);
    preserved("parent-observation-failed");
    return 0;
  }
  snprintf(parent_device, sizeof(parent_device), "%llu",
    (unsigned long long)parent_stats.st_dev);
  snprintf(parent_inode, sizeof(parent_inode), "%llu",
    (unsigned long long)parent_stats.st_ino);
  if (fstatat(parent, base, &before, AT_SYMLINK_NOFOLLOW) != 0) {
    close(parent);
    if (errno == ENOENT) {
      printf("{\"ok\":true,\"disposition\":\"absent\","
        "\"parentDevice\":\"%s\",\"parentInode\":\"%s\"}\n",
        parent_device, parent_inode);
      fflush(stdout);
      return 0;
    }
    preserved("observation-failed");
    return 0;
  }
  if (!S_ISREG(before.st_mode) || before.st_uid != getuid() || (before.st_mode & 0022) != 0
    || before.st_size < 0 || before.st_size > (off_t)MAX_CONTENT_BYTES) {
    close(parent);
    preserved("unsafe-final");
    return 0;
  }
  descriptor = openat(parent, base, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  close(parent);
  if (descriptor < 0) {
    preserved("final-open-failed");
    return 0;
  }
  bytes = malloc(before.st_size == 0 ? 1U : (size_t)before.st_size);
  if (bytes == NULL) {
    close(descriptor);
    return -1;
  }
  while (offset < before.st_size) {
    ssize_t read_count = read(descriptor, bytes + offset, (size_t)(before.st_size - offset));
    if (read_count <= 0) {
      free(bytes); close(descriptor); return -1;
    }
    offset += read_count;
  }
  if (fstat(descriptor, &after) != 0
    || before.st_dev != after.st_dev || before.st_ino != after.st_ino
    || before.st_size != after.st_size || before.st_mtime != after.st_mtime
    || before.st_ctime != after.st_ctime) {
    free(bytes); close(descriptor); preserved("final-changed"); return 0;
  }
  close(descriptor);
  digest_hex(bytes, (size_t)before.st_size, digest);
  free(bytes);
  snprintf(device, sizeof(device), "%llu", (unsigned long long)before.st_dev);
  snprintf(inode, sizeof(inode), "%llu", (unsigned long long)before.st_ino);
  snprintf(mode, sizeof(mode), "%o", before.st_mode & 0777);
  snprintf(uid, sizeof(uid), "%llu", (unsigned long long)before.st_uid);
  snprintf(size, sizeof(size), "%llu", (unsigned long long)before.st_size);
  printf("{\"ok\":true,\"disposition\":\"observed\",\"digest\":\"%s\","
    "\"device\":\"%s\",\"inode\":\"%s\",\"mode\":\"%s\",\"uid\":\"%s\",\"size\":\"%s\","
    "\"parentDevice\":\"%s\",\"parentInode\":\"%s\"}\n",
    digest, device, inode, mode, uid, size, parent_device, parent_inode);
  fflush(stdout);
  return 0;
}

static int handle_create(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {"operation", "path", "contentBase64", "mode"};
  const char *relative;
  const char *encoded;
  const char *mode_text;
  char base[MAX_COMPONENT_BYTES + 1];
  char digest[72], device[32], inode[32];
  uint8_t *bytes = NULL;
  size_t length = 0;
  mode_t mode;
  struct stat created, published;
  int parent;
  int descriptor;
  if (!exact_keys(fields, count, keys, 4)
    || strcmp(field_value(fields, count, "operation"), "create-only") != 0) return -1;
  relative = field_value(fields, count, "path");
  encoded = field_value(fields, count, "contentBase64");
  mode_text = field_value(fields, count, "mode");
  if (strcmp(mode_text, "600") == 0) mode = 0600;
  else if (strcmp(mode_text, "700") == 0) mode = 0700;
  else if (strcmp(mode_text, "644") == 0) mode = 0644;
  else if (strcmp(mode_text, "755") == 0) mode = 0755;
  else return -1;
  if (decode_base64(encoded, &bytes, &length) != 0) return -1;
  parent = open_parent(relative, base);
  if (parent < 0) {
    free(bytes);
    preserved("unsafe-ancestor");
    return 0;
  }
  descriptor = openat(
    parent,
    ".",
    O_WRONLY | O_TMPFILE | O_CLOEXEC,
    mode
  );
  if (descriptor < 0
    || write_all(descriptor, bytes, length) != 0
    || fchmod(descriptor, mode) != 0
    || fsync(descriptor) != 0
    || fstat(descriptor, &created) != 0
    || !S_ISREG(created.st_mode)
    || created.st_uid != getuid()
    || created.st_nlink != 0
    || (created.st_mode & 0777) != mode) {
    if (descriptor >= 0) close(descriptor);
    free(bytes);
    close(parent);
    return -1;
  }
  if (linkat(descriptor, "", parent, base, AT_EMPTY_PATH) != 0) {
    int saved = errno;
    close(descriptor);
    free(bytes);
    close(parent);
    if (saved == EEXIST || saved == ENOTEMPTY || saved == ELOOP) {
      preserved("destination-exists");
      return 0;
    }
    preserved("publication-refused");
    return 0;
  }
  if (fsync(parent) != 0
    || fstatat(parent, base, &published, AT_SYMLINK_NOFOLLOW) != 0
    || created.st_dev != published.st_dev
    || created.st_ino != published.st_ino
    || !S_ISREG(published.st_mode)
    || published.st_nlink != 1
    || (published.st_mode & 0777) != mode) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("post-publication-unknown");
    return 0;
  }
  digest_hex(bytes, length, digest);
  free(bytes);
  snprintf(device, sizeof(device), "%llu", (unsigned long long)published.st_dev);
  snprintf(inode, sizeof(inode), "%llu", (unsigned long long)published.st_ino);
  close(descriptor);
  close(parent);
  printf("{\"ok\":true,\"disposition\":\"created\",\"digest\":\"%s\","
    "\"device\":\"%s\",\"inode\":\"%s\"}\n", digest, device, inode);
  fflush(stdout);
  return 0;
}

static int handle_replace_exact(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {
    "operation",
    "path",
    "contentBase64",
    "parentDevice",
    "parentInode",
    "fileDevice",
    "fileInode",
    "fileMode",
    "fileOwner",
    "expectedBaseDigest",
    "desiredDigest",
  };
  const char *relative;
  const char *encoded;
  const char *expected_parent_device;
  const char *expected_parent_inode;
  const char *expected_file_device;
  const char *expected_file_inode;
  const char *expected_file_mode;
  const char *expected_file_owner;
  const char *expected_base_digest;
  const char *expected_desired_digest;
  char base[MAX_COMPONENT_BYTES + 1];
  char actual_parent_device[32], actual_parent_inode[32];
  char actual_file_device[32], actual_file_inode[32];
  char actual_file_mode[16], actual_file_owner[32];
  char actual_base_digest[72], actual_desired_digest[72];
  uint8_t *bytes = NULL;
  size_t length = 0;
  struct stat parent_stats;
  struct stat before;
  struct stat after_read;
  struct stat before_name;
  struct stat after_write;
  struct stat after_name;
  struct stat durable_name;
  int parent = -1;
  int descriptor = -1;
  int result = 0;
  if (!exact_keys(fields, count, keys, 11)
    || strcmp(
      field_value(fields, count, "operation"),
      "replace-exact"
    ) != 0) return -1;
  relative = field_value(fields, count, "path");
  encoded = field_value(fields, count, "contentBase64");
  expected_parent_device = field_value(fields, count, "parentDevice");
  expected_parent_inode = field_value(fields, count, "parentInode");
  expected_file_device = field_value(fields, count, "fileDevice");
  expected_file_inode = field_value(fields, count, "fileInode");
  expected_file_mode = field_value(fields, count, "fileMode");
  expected_file_owner = field_value(fields, count, "fileOwner");
  expected_base_digest = field_value(fields, count, "expectedBaseDigest");
  expected_desired_digest = field_value(fields, count, "desiredDigest");
  if (!decimal_text(expected_parent_device)
    || !decimal_text(expected_parent_inode)
    || !decimal_text(expected_file_device)
    || !decimal_text(expected_file_inode)
    || !mode_text(expected_file_mode)
    || !decimal_text(expected_file_owner)
    || !digest_text(expected_base_digest)
    || !digest_text(expected_desired_digest)
    || decode_base64(encoded, &bytes, &length) != 0) return -1;
  digest_hex(bytes, length, actual_desired_digest);
  if (strcmp(actual_desired_digest, expected_desired_digest) != 0) {
    free(bytes);
    preserved("desired-digest-mismatch");
    return 0;
  }
  parent = open_parent(relative, base);
  if (parent < 0) {
    free(bytes);
    preserved("unsafe-ancestor");
    return 0;
  }
  if (fstat(parent, &parent_stats) != 0
    || !safe_directory(&parent_stats, 1)
    || parent_stats.st_dev != root_device) {
    free(bytes);
    close(parent);
    preserved("unsafe-parent");
    return 0;
  }
  snprintf(actual_parent_device, sizeof(actual_parent_device), "%llu",
    (unsigned long long)parent_stats.st_dev);
  snprintf(actual_parent_inode, sizeof(actual_parent_inode), "%llu",
    (unsigned long long)parent_stats.st_ino);
  if (strcmp(actual_parent_device, expected_parent_device) != 0
    || strcmp(actual_parent_inode, expected_parent_inode) != 0) {
    free(bytes);
    close(parent);
    preserved("parent-identity-mismatch");
    return 0;
  }
  descriptor = openat(
    parent,
    base,
    O_RDWR | O_NOFOLLOW | O_CLOEXEC
  );
  if (descriptor < 0 || fstat(descriptor, &before) != 0) {
    if (descriptor >= 0) close(descriptor);
    free(bytes);
    close(parent);
    preserved("file-open-failed");
    return 0;
  }
  if (!S_ISREG(before.st_mode)
    || before.st_uid != getuid()
    || before.st_dev != root_device
    || before.st_size < 0
    || before.st_size > (off_t)MAX_CONTENT_BYTES) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("unsafe-file");
    return 0;
  }
  if (before.st_nlink != 1) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("unsafe-file-links");
    return 0;
  }
  snprintf(actual_file_device, sizeof(actual_file_device), "%llu",
    (unsigned long long)before.st_dev);
  snprintf(actual_file_inode, sizeof(actual_file_inode), "%llu",
    (unsigned long long)before.st_ino);
  snprintf(actual_file_mode, sizeof(actual_file_mode), "%o",
    before.st_mode & 0777);
  snprintf(actual_file_owner, sizeof(actual_file_owner), "%llu",
    (unsigned long long)before.st_uid);
  if (strcmp(actual_file_device, expected_file_device) != 0
    || strcmp(actual_file_inode, expected_file_inode) != 0) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("file-identity-mismatch");
    return 0;
  }
  if (strcmp(actual_file_mode, expected_file_mode) != 0
    || strcmp(actual_file_owner, expected_file_owner) != 0) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("file-policy-mismatch");
    return 0;
  }
  if (digest_descriptor(
      descriptor,
      before.st_size,
      actual_base_digest
    ) != 0
    || fstat(descriptor, &after_read) != 0
    || !same_file_snapshot(&before, &after_read)
    || after_read.st_nlink != 1
    || fstatat(parent, base, &before_name, AT_SYMLINK_NOFOLLOW) != 0
    || !same_exact_regular_file(&before_name, &before)) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("pre-write-identity-ambiguous");
    return 0;
  }
  if (strcmp(actual_base_digest, expected_base_digest) != 0) {
    close(descriptor);
    free(bytes);
    close(parent);
    preserved("base-digest-mismatch");
    return 0;
  }
  if (lseek(descriptor, 0, SEEK_SET) < 0
    || ftruncate(descriptor, 0) != 0
    || write_all(descriptor, bytes, length) != 0
    || ftruncate(descriptor, (off_t)length) != 0
    || fsync(descriptor) != 0) {
    printf("{\"ok\":true,\"disposition\":\"preserved\","
      "\"reason\":\"write-incomplete\","
      "\"complete\":false,"
      "\"writeState\":\"incomplete-on-retained-inode\"}\n");
    fflush(stdout);
    result = 0;
    goto replace_done;
  }
  if (digest_descriptor(
      descriptor,
      (off_t)length,
      actual_desired_digest
    ) != 0
    || fstat(descriptor, &after_write) != 0
    || !same_exact_regular_file(&after_write, &before)
    || after_write.st_size != (off_t)length
    || strcmp(actual_desired_digest, expected_desired_digest) != 0) {
    printf("{\"ok\":true,\"disposition\":\"preserved\","
      "\"reason\":\"post-write-digest-ambiguous\","
      "\"complete\":false,"
      "\"writeState\":\"incomplete-on-retained-inode\"}\n");
    fflush(stdout);
    result = 0;
    goto replace_done;
  }
#if defined(AGENTMO_FS_TEST_POST_WRITE_STOP)
  fputs("{\"ok\":true,\"disposition\":\"test-post-write-ready\","
    "\"writeState\":\"desired-bytes-durable-on-retained-inode\"}\n", stdout);
  fflush(stdout);
  if (raise(SIGSTOP) != 0) {
    printf("{\"ok\":true,\"disposition\":\"preserved\","
      "\"reason\":\"post-write-test-stop-failed\","
      "\"complete\":false,"
      "\"writeState\":\"desired-bytes-durable-on-retained-inode\"}\n");
    fflush(stdout);
    result = 0;
    goto replace_done;
  }
#endif
  if (fstatat(parent, base, &after_name, AT_SYMLINK_NOFOLLOW) != 0
    || !same_exact_regular_file(&after_name, &before)
    || after_name.st_size != (off_t)length
    || fsync(parent) != 0
    || fstatat(parent, base, &durable_name, AT_SYMLINK_NOFOLLOW) != 0
    || !same_exact_regular_file(&durable_name, &before)
    || durable_name.st_size != (off_t)length) {
    printf("{\"ok\":true,\"disposition\":\"preserved\","
      "\"reason\":\"post-write-name-ambiguous\","
      "\"complete\":false,"
      "\"writeState\":\"desired-bytes-durable-on-retained-inode\","
      "\"digest\":\"%s\",\"device\":\"%s\",\"inode\":\"%s\"}\n",
      actual_desired_digest, actual_file_device, actual_file_inode);
    fflush(stdout);
    result = 0;
    goto replace_done;
  }
  printf("{\"ok\":true,\"disposition\":\"replaced\","
    "\"guarantee\":\"identity-bound-durable-write\","
    "\"digest\":\"%s\",\"device\":\"%s\",\"inode\":\"%s\"}\n",
    actual_desired_digest, actual_file_device, actual_file_inode);
  fflush(stdout);
  result = 0;

replace_done:
  close(descriptor);
  free(bytes);
  close(parent);
  return result;
}

static void close_reservation(void) {
  if (reservation_fd >= 0) close(reservation_fd);
  if (reservation_parent_fd >= 0) close(reservation_parent_fd);
  reservation_fd = -1;
  reservation_parent_fd = -1;
  reservation_path[0] = '\0';
  reservation_base[0] = '\0';
  memset(&reservation_identity, 0, sizeof(reservation_identity));
}

static int handle_reserve_marker(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {"operation", "path"};
  const char *relative;
  char base[MAX_COMPONENT_BYTES + 1];
  char device[32], inode[32];
  struct stat created;
  int parent;
  int descriptor;
  if (!exact_keys(fields, count, keys, 2)
    || strcmp(field_value(fields, count, "operation"), "reserve-marker") != 0
    || reservation_fd >= 0 || reservation_parent_fd >= 0) return -1;
  relative = field_value(fields, count, "path");
  parent = open_parent(relative, base);
  if (parent < 0) {
    preserved("unsafe-ancestor");
    return 0;
  }
  descriptor = openat(
    parent,
    base,
    O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
    0600
  );
  if (descriptor < 0) {
    int saved = errno;
    close(parent);
    if (saved == EEXIST || saved == ENOTEMPTY || saved == ELOOP) {
      preserved("destination-exists");
      return 0;
    }
    preserved("reservation-refused");
    return 0;
  }
  if (fchmod(descriptor, 0600) != 0
    || fstat(descriptor, &created) != 0
    || !S_ISREG(created.st_mode)
    || created.st_uid != getuid()
    || created.st_nlink != 1
    || (created.st_mode & 0777) != 0600
    || fsync(parent) != 0) {
    close(descriptor);
    close(parent);
    preserved("reservation-durability-unknown");
    return 0;
  }
  reservation_fd = descriptor;
  reservation_parent_fd = parent;
  reservation_identity = created;
  strcpy(reservation_path, relative);
  strcpy(reservation_base, base);
  snprintf(device, sizeof(device), "%llu", (unsigned long long)created.st_dev);
  snprintf(inode, sizeof(inode), "%llu", (unsigned long long)created.st_ino);
  printf("{\"ok\":true,\"disposition\":\"reserved\",\"device\":\"%s\","
    "\"inode\":\"%s\"}\n", device, inode);
  fflush(stdout);
  return 0;
}

static int handle_finalize_marker(field_t fields[MAX_FIELDS], size_t count) {
  static const char *keys[] = {"operation", "path", "contentBase64"};
  const char *relative;
  const char *encoded;
  char digest[72], device[32], inode[32];
  uint8_t *bytes = NULL;
  size_t length = 0;
  struct stat current, published;
  int valid = 1;
  if (!exact_keys(fields, count, keys, 3)
    || strcmp(field_value(fields, count, "operation"), "finalize-marker") != 0
    || reservation_fd < 0 || reservation_parent_fd < 0) return -1;
  relative = field_value(fields, count, "path");
  encoded = field_value(fields, count, "contentBase64");
  if (strcmp(relative, reservation_path) != 0
    || decode_base64(encoded, &bytes, &length) != 0
    || length == 0) return -1;
  if (write_all(reservation_fd, bytes, length) != 0
    || fsync(reservation_fd) != 0
    || fstat(reservation_fd, &current) != 0
    || current.st_dev != reservation_identity.st_dev
    || current.st_ino != reservation_identity.st_ino
    || !S_ISREG(current.st_mode)
    || current.st_uid != getuid()
    || current.st_nlink != 1
    || (current.st_mode & 0777) != 0600
    || current.st_size != (off_t)length) valid = 0;
  close(reservation_fd);
  reservation_fd = -1;
  if (valid
    && (fsync(reservation_parent_fd) != 0
      || fstatat(
        reservation_parent_fd,
        reservation_base,
        &published,
        AT_SYMLINK_NOFOLLOW
      ) != 0
      || published.st_dev != reservation_identity.st_dev
      || published.st_ino != reservation_identity.st_ino
      || !S_ISREG(published.st_mode)
      || published.st_uid != getuid()
      || published.st_nlink != 1
      || (published.st_mode & 0777) != 0600
      || published.st_size != (off_t)length)) valid = 0;
  close(reservation_parent_fd);
  reservation_parent_fd = -1;
  if (!valid) {
    free(bytes);
    reservation_path[0] = '\0';
    reservation_base[0] = '\0';
    memset(&reservation_identity, 0, sizeof(reservation_identity));
    preserved("reservation-finalization-unknown");
    return 0;
  }
  digest_hex(bytes, length, digest);
  free(bytes);
  snprintf(device, sizeof(device), "%llu",
    (unsigned long long)reservation_identity.st_dev);
  snprintf(inode, sizeof(inode), "%llu",
    (unsigned long long)reservation_identity.st_ino);
  reservation_path[0] = '\0';
  reservation_base[0] = '\0';
  memset(&reservation_identity, 0, sizeof(reservation_identity));
  printf("{\"ok\":true,\"disposition\":\"created\",\"digest\":\"%s\","
    "\"device\":\"%s\",\"inode\":\"%s\"}\n", digest, device, inode);
  fflush(stdout);
  return 0;
}

static int dispatch(field_t fields[MAX_FIELDS], size_t count) {
  const char *operation = field_value(fields, count, "operation");
  if (operation == NULL) return -1;
  if (root_fd < 0) return handle_open(fields, count);
  if (strcmp(operation, "observe") == 0) return handle_observe(fields, count);
  if (strcmp(operation, "create-only") == 0) return handle_create(fields, count);
  if (strcmp(operation, "replace-exact") == 0) {
    return handle_replace_exact(fields, count);
  }
  if (strcmp(operation, "publish-no-replace") == 0) {
    return handle_publish_no_replace(fields, count);
  }
  if (strcmp(operation, "reserve-marker") == 0) {
    return handle_reserve_marker(fields, count);
  }
  if (strcmp(operation, "finalize-marker") == 0) {
    return handle_finalize_marker(fields, count);
  }
  if (strcmp(operation, "close") == 0) {
    static const char *keys[] = {"operation"};
    if (!exact_keys(fields, count, keys, 1)) return -1;
    close_reservation();
    fputs("{\"ok\":true,\"disposition\":\"closed\"}\n", stdout);
    fflush(stdout);
    return 1;
  }
  return -1;
}

int main(void) {
  char *line = malloc(MAX_LINE_BYTES + 2U);
  int status = 0;
  if (line == NULL) return 1;
  while (fgets(line, (int)MAX_LINE_BYTES + 2, stdin) != NULL) {
    size_t length = strlen(line);
    field_t fields[MAX_FIELDS] = {0};
    size_t count = 0;
    int result;
    if (length == 0 || line[length - 1] != '\n') {
      protocol_failure();
      status = 1;
      break;
    }
    line[length - 1] = '\0';
    if (parse_object(line, fields, &count) != 0) {
      protocol_failure();
      status = 1;
      break;
    }
    result = dispatch(fields, count);
    free_fields(fields, count);
    if (result < 0) {
      protocol_failure();
      status = 1;
      break;
    }
    if (result > 0) break;
  }
  close_reservation();
  if (root_fd >= 0) close(root_fd);
  free(line);
  return status;
}
