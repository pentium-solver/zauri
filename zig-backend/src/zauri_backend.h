#ifndef ZAURI_BACKEND_H
#define ZAURI_BACKEND_H

#include <stdint.h>
#include <stddef.h>

// File operations
int32_t zauri_read_file(const char* path, char* buf, uint32_t buf_len, uint32_t* bytes_read);
int32_t zauri_write_file(const char* path, const char* data, uint32_t data_len);

// Directory listing (returns JSON array of entries)
int32_t zauri_list_dir(const char* path, char* buf, uint32_t buf_len, uint32_t* bytes_written);

// Search (returns JSON array of matches)
int32_t zauri_search(const char* root_path, const char* query, char* buf, uint32_t buf_len, uint32_t* bytes_written);

// Free any allocated resources
void zauri_init(void);

#endif
