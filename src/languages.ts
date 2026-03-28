import { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

// Official CM6 language packages
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";

// Legacy modes (CM5 ported to CM6 via StreamLanguage)
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { r } from "@codemirror/legacy-modes/mode/r";

/**
 * Returns the appropriate CodeMirror language extension for a file.
 * Covers 40+ file types including config files, lock files, and dotfiles.
 */
export function getLanguageExtension(filename: string): Extension {
  const lower = filename.toLowerCase();
  const ext = lower.split(".").pop() || "";
  const base = lower.split("/").pop() || lower;

  // Special filenames first (no extension or specific names)
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return StreamLanguage.define(dockerFile);
  if (base === "caddyfile" || base === "caddy") return StreamLanguage.define(nginx); // similar syntax
  if (base === "cmakelists.txt") return StreamLanguage.define(cmake);
  if (base === "makefile" || base === "gnumakefile") return StreamLanguage.define(shell);
  if (base === ".env" || base.startsWith(".env.")) return StreamLanguage.define(properties);
  if (base === ".gitignore" || base === ".gitattributes" || base === ".gitmodules") return StreamLanguage.define(properties);
  if (base === ".dockerignore" || base === ".npmignore" || base === ".eslintignore") return StreamLanguage.define(properties);
  if (base === ".editorconfig") return StreamLanguage.define(properties);
  if (base === "bun.lock" || base === "bun.lockb") return json();
  if (base === "cargo.lock") return StreamLanguage.define(toml);
  if (base === "cargo.toml") return StreamLanguage.define(toml);
  if (base === "package.json" || base === "tsconfig.json" || base === "jsconfig.json") return json();
  if (base === "package-lock.json" || base === "composer.lock") return json();
  if (base === ".babelrc" || base === ".prettierrc" || base === ".eslintrc") return json();

  // By extension
  switch (ext) {
    // JavaScript / TypeScript
    case "js": case "mjs": case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts": case "mts": case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });

    // Web
    case "html": case "htm": case "svelte": case "vue":
      return html();
    case "css": case "scss": case "less":
      return css();

    // Data / Config
    case "json": case "jsonc": case "json5": case "geojson":
    case "webmanifest": case "map":
      return json();
    case "yaml": case "yml":
      return yaml();
    case "toml":
      return StreamLanguage.define(toml);
    case "xml": case "xsl": case "xsd": case "wsdl":
    case "svg": case "plist":
      return xml();
    case "ini": case "cfg": case "conf":
      return StreamLanguage.define(properties);

    // Systems languages
    case "rs":
      return rust();
    case "go":
      return go();
    case "c": case "h":
      return cpp();
    case "cpp": case "cxx": case "cc": case "hpp": case "hxx": case "hh":
      return cpp();
    case "zig":
      return cpp(); // Closest available grammar
    case "java": case "kt": case "kts": case "groovy": case "gradle":
      return java();
    case "swift":
      return StreamLanguage.define(swift);

    // Scripting
    case "py": case "pyw": case "pyx": case "pyi":
      return python();
    case "rb": case "rake": case "gemspec":
      return StreamLanguage.define(ruby);
    case "lua":
      return StreamLanguage.define(lua);
    case "pl": case "pm":
      return StreamLanguage.define(perl);
    case "r": case "rmd":
      return StreamLanguage.define(r);
    case "hs": case "lhs":
      return StreamLanguage.define(haskell);
    case "php":
      return php();

    // Shell
    case "sh": case "bash": case "zsh": case "fish": case "ksh":
      return StreamLanguage.define(shell);

    // SQL
    case "sql": case "mysql": case "pgsql": case "sqlite":
      return sql();

    // Markup / Docs
    case "md": case "mdx": case "markdown":
      return markdown();
    case "diff": case "patch":
      return StreamLanguage.define(diff);

    // Infrastructure
    case "proto":
      return StreamLanguage.define(protobuf);
    case "cmake":
      return StreamLanguage.define(cmake);
    case "nginx":
      return StreamLanguage.define(nginx);

    // Lock / generated files (best-effort)
    case "lock":
      // Most lock files are YAML or TOML-ish
      return yaml();
    case "log":
      return StreamLanguage.define(properties);

    default:
      return [];
  }
}
