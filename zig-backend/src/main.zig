const std = @import("std");
const fs = std.fs;
const mem = std.mem;

var gpa = std.heap.GeneralPurposeAllocator(.{}){};

export fn zauri_init() void {}

export fn zauri_read_file(path: [*c]const u8, buf: [*c]u8, buf_len: u32, bytes_read: *u32) i32 {
    const path_slice = mem.sliceTo(path, 0);
    const file = fs.cwd().openFile(path_slice, .{}) catch return -1;
    defer file.close();

    const n = file.readAll(buf[0..buf_len]) catch return -2;
    bytes_read.* = @intCast(n);
    return 0;
}

export fn zauri_write_file(path: [*c]const u8, data: [*c]const u8, data_len: u32) i32 {
    const path_slice = mem.sliceTo(path, 0);
    const file = fs.cwd().createFile(path_slice, .{}) catch return -1;
    defer file.close();

    file.writeAll(data[0..data_len]) catch return -2;
    return 0;
}

export fn zauri_list_dir(path: [*c]const u8, buf: [*c]u8, buf_len: u32, bytes_written: *u32) i32 {
    const allocator = gpa.allocator();
    const path_slice = mem.sliceTo(path, 0);

    var dir = fs.cwd().openDir(path_slice, .{ .iterate = true }) catch return -1;
    defer dir.close();

    var entries: std.ArrayList(u8) = .empty;
    defer entries.deinit(allocator);

    entries.appendSlice(allocator, "[") catch return -3;

    var first = true;
    var iter = dir.iterate();
    while (iter.next() catch return -2) |entry| {
        if (!first) {
            entries.appendSlice(allocator, ",") catch return -3;
        }
        first = false;

        entries.appendSlice(allocator, "{\"name\":\"") catch return -3;
        for (entry.name) |c| {
            switch (c) {
                '"' => entries.appendSlice(allocator, "\\\"") catch return -3,
                '\\' => entries.appendSlice(allocator, "\\\\") catch return -3,
                '\n' => entries.appendSlice(allocator, "\\n") catch return -3,
                else => entries.append(allocator, c) catch return -3,
            }
        }
        entries.appendSlice(allocator, "\",\"is_dir\":") catch return -3;
        if (entry.kind == .directory) {
            entries.appendSlice(allocator, "true") catch return -3;
        } else {
            entries.appendSlice(allocator, "false") catch return -3;
        }
        entries.appendSlice(allocator, "}") catch return -3;
    }

    entries.appendSlice(allocator, "]") catch return -3;

    if (entries.items.len > buf_len) return -4;
    @memcpy(buf[0..entries.items.len], entries.items);
    bytes_written.* = @intCast(entries.items.len);
    return 0;
}

export fn zauri_search(root_path: [*c]const u8, query_ptr: [*c]const u8, buf: [*c]u8, buf_len: u32, bytes_written: *u32) i32 {
    const allocator = gpa.allocator();
    const root = mem.sliceTo(root_path, 0);
    const query = mem.sliceTo(query_ptr, 0);

    var results: std.ArrayList(u8) = .empty;
    defer results.deinit(allocator);

    results.appendSlice(allocator, "[") catch return -3;

    var first = true;
    searchDir(allocator, root, query, &results, &first, 0, buf_len) catch return -2;

    results.appendSlice(allocator, "]") catch return -3;

    if (results.items.len > buf_len) return -4;
    @memcpy(buf[0..results.items.len], results.items);
    bytes_written.* = @intCast(results.items.len);
    return 0;
}

fn searchDir(
    allocator: mem.Allocator,
    dir_path: []const u8,
    query: []const u8,
    results: *std.ArrayList(u8),
    first: *bool,
    depth: u32,
    max_size: u32,
) !void {
    if (depth > 10) return;

    var dir = fs.cwd().openDir(dir_path, .{ .iterate = true }) catch return;
    defer dir.close();

    var iter = dir.iterate();
    while (try iter.next()) |entry| {
        if (entry.name.len > 0 and entry.name[0] == '.') continue;
        if (mem.eql(u8, entry.name, "node_modules")) continue;
        if (mem.eql(u8, entry.name, "target")) continue;
        if (mem.eql(u8, entry.name, "zig-cache")) continue;
        if (mem.eql(u8, entry.name, "zig-out")) continue;
        if (mem.eql(u8, entry.name, "dist")) continue;

        const full_path = std.fmt.allocPrint(allocator, "{s}/{s}", .{ dir_path, entry.name }) catch return;
        defer allocator.free(full_path);

        if (entry.kind == .directory) {
            searchDir(allocator, full_path, query, results, first, depth + 1, max_size) catch continue;
        } else {
            searchFile(allocator, full_path, query, results, first, max_size) catch continue;
        }

        if (results.items.len > max_size / 2) return;
    }
}

fn searchFile(
    allocator: mem.Allocator,
    full_path: []const u8,
    query: []const u8,
    results: *std.ArrayList(u8),
    first: *bool,
    max_size: u32,
) !void {
    const file = fs.cwd().openFile(full_path, .{}) catch return;
    defer file.close();

    const stat = file.stat() catch return;
    if (stat.size > 1024 * 1024) return;

    const content = file.readToEndAlloc(allocator, 1024 * 1024) catch return;
    defer allocator.free(content);

    var line_num: u32 = 1;
    var line_start: usize = 0;
    for (content, 0..) |c, i| {
        if (c == '\n' or i == content.len - 1) {
            const line_end = if (c == '\n') i else i + 1;
            const line = content[line_start..line_end];
            if (mem.indexOf(u8, line, query)) |col| {
                if (!first.*) {
                    try results.appendSlice(allocator, ",");
                }
                first.* = false;

                const match_json = std.fmt.allocPrint(allocator, "{{\"file\":\"{s}\",\"line\":{d},\"col\":{d},\"text\":\"", .{ full_path, line_num, col + 1 }) catch return;
                defer allocator.free(match_json);
                try results.appendSlice(allocator, match_json);

                const max_len = @min(line.len, 200);
                for (line[0..max_len]) |ch| {
                    switch (ch) {
                        '"' => try results.appendSlice(allocator, "\\\""),
                        '\\' => try results.appendSlice(allocator, "\\\\"),
                        '\n' => try results.appendSlice(allocator, "\\n"),
                        '\r' => try results.appendSlice(allocator, "\\r"),
                        '\t' => try results.appendSlice(allocator, "\\t"),
                        else => {
                            if (ch >= 0x20) {
                                try results.append(allocator, ch);
                            }
                        },
                    }
                }
                try results.appendSlice(allocator, "\"}");

                if (results.items.len > max_size / 2) return;
            }
            line_start = i + 1;
            line_num += 1;
        }
    }
}
