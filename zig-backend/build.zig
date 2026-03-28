const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    const lib = b.addLibrary(.{
        .linkage = .static,
        .name = "zauri_backend",
        .root_module = mod,
    });

    b.installArtifact(lib);

    const install_header = b.addInstallFileWithDir(
        b.path("src/zauri_backend.h"),
        .header,
        "zauri_backend.h",
    );
    b.getInstallStep().dependOn(&install_header.step);
}
