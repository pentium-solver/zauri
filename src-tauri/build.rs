use std::process::Command;

fn main() {
    // Build Zig backend first
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let zig_dir = std::path::Path::new(&manifest_dir).join("../zig-backend");

    let mut zig_args = vec!["build".to_string(), "-Doptimize=ReleaseFast".to_string()];

    // On Windows MSVC, tell Zig to target MSVC ABI to avoid MinGW symbol conflicts
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows") && target.contains("msvc") {
        zig_args.push("-Dtarget=x86_64-windows-msvc".to_string());
    }

    let status = Command::new("zig")
        .args(&zig_args)
        .current_dir(&zig_dir)
        .status()
        .expect("Failed to run zig build");

    if !status.success() {
        panic!("Zig build failed");
    }

    let lib_dir = zig_dir.join("zig-out/lib");
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static=zauri_backend");

    // Rerun if zig sources change
    println!("cargo:rerun-if-changed=../zig-backend/src/main.zig");
    println!("cargo:rerun-if-changed=../zig-backend/build.zig");

    tauri_build::build();
}
