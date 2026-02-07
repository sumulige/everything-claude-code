use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn read_stdin_json<T: for<'de> Deserialize<'de>>() -> Result<T, String> {
    let mut buf = String::new();
    io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| format!("failed to read stdin: {e}"))?;
    let trimmed = buf.trim();
    if trimmed.is_empty() {
        return Err("missing JSON input on stdin".to_string());
    }
    serde_json::from_str(trimmed).map_err(|e| format!("invalid JSON input: {e}"))
}

fn write_stdout_json<T: Serialize>(value: &T) -> Result<(), String> {
    let out = serde_json::to_string(value).map_err(|e| format!("failed to serialize JSON: {e}"))?;
    print!("{out}");
    Ok(())
}

#[derive(Debug)]
struct CmdOut {
    ok: bool,
    status: i32,
    stdout: String,
    stderr: String,
}

fn run_cmd(program: &str, args: &[String], cwd: Option<&Path>) -> Result<CmdOut, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let output = cmd.output().map_err(|e| format!("{program} failed: {e}"))?;
    let status = output.status.code().unwrap_or(1);
    Ok(CmdOut {
        ok: output.status.success(),
        status,
        stdout: String::from_utf8_lossy(&output.stdout).trim_end().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim_end().to_string(),
    })
}

fn run_git(args: &[String], cwd: Option<&Path>) -> Result<CmdOut, String> {
    run_cmd("git", args, cwd)
}

fn normalize_worktree_path(path: &Path) -> PathBuf {
    // Lexical normalization (no FS access): removes `.` and collapses `..` where possible.
    let mut out: Vec<Component<'_>> = Vec::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if let Some(last) = out.last() {
                    if matches!(last, Component::ParentDir) {
                        out.push(c);
                    } else if !matches!(last, Component::RootDir | Component::Prefix(_)) {
                        out.pop();
                    } else {
                        out.push(c);
                    }
                } else {
                    out.push(c);
                }
            }
            _ => out.push(c),
        }
    }

    let mut pb = PathBuf::new();
    for c in out {
        pb.push(c.as_os_str());
    }
    pb
}

fn abs_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(normalize_worktree_path(path))
    } else {
        let cwd = std::env::current_dir().map_err(|e| format!("failed to get cwd: {e}"))?;
        Ok(normalize_worktree_path(&cwd.join(path)))
    }
}

fn assert_external_worktree_path(repo_root: &Path, worktree_path: &Path) -> Result<(), String> {
    let repo = abs_path(repo_root)?;
    let wt = abs_path(worktree_path)?;
    if wt.starts_with(&repo) {
        return Err(format!(
            "Refusing to create worktree inside repo root (would recurse): repoRoot={} worktreePath={}",
            repo.display(),
            wt.display()
        ));
    }
    Ok(())
}

fn is_git_worktree(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    let args = vec![
        "-C".to_string(),
        dir.display().to_string(),
        "rev-parse".to_string(),
        "--is-inside-work-tree".to_string(),
    ];
    match run_git(&args, None) {
        Ok(out) => out.ok && out.stdout.trim() == "true",
        Err(_) => false,
    }
}

fn branch_exists(repo_root: &Path, branch: &str) -> bool {
    let args = vec![
        "-C".to_string(),
        repo_root.display().to_string(),
        "show-ref".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("refs/heads/{branch}"),
    ];
    match run_git(&args, None) {
        Ok(out) => out.status == 0,
        Err(_) => false,
    }
}

fn ensure_branch_at(repo_root: &Path, branch: &str, base_sha: &str) -> Result<(), String> {
    if branch_exists(repo_root, branch) {
        return Ok(());
    }
    let args = vec![
        "-C".to_string(),
        repo_root.display().to_string(),
        "branch".to_string(),
        branch.to_string(),
        base_sha.to_string(),
    ];
    let out = run_git(&args, None)?;
    if !out.ok {
        return Err(out.stderr.is_empty().then(|| format!("git branch failed")).unwrap_or(out.stderr));
    }
    Ok(())
}

#[derive(Deserialize)]
struct WorktreeEnsureIn {
    repoRoot: String,
    worktreePath: String,
    branch: String,
    baseSha: String,
}

#[derive(Serialize)]
struct WorktreeEnsureOut {
    worktreePath: String,
}

fn worktree_ensure(input: WorktreeEnsureIn) -> Result<WorktreeEnsureOut, String> {
    let repo_root = PathBuf::from(input.repoRoot);
    let worktree_path = PathBuf::from(input.worktreePath);
    assert_external_worktree_path(&repo_root, &worktree_path)?;
    ensure_branch_at(&repo_root, &input.branch, &input.baseSha)?;

    if worktree_path.exists() {
        if !is_git_worktree(&worktree_path) {
            return Err(format!(
                "Worktree path exists but is not a git worktree: {}",
                worktree_path.display()
            ));
        }
        return Ok(WorktreeEnsureOut {
            worktreePath: worktree_path.display().to_string(),
        });
    }

    if let Some(parent) = worktree_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create worktree parent dir: {e}"))?;
    }

    let args = vec![
        "-C".to_string(),
        repo_root.display().to_string(),
        "worktree".to_string(),
        "add".to_string(),
        worktree_path.display().to_string(),
        input.branch,
    ];
    let out = run_git(&args, None)?;
    if !out.ok {
        return Err(if out.stderr.is_empty() {
            format!("git worktree add failed: {}", worktree_path.display())
        } else {
            out.stderr
        });
    }
    Ok(WorktreeEnsureOut {
        worktreePath: worktree_path.display().to_string(),
    })
}

#[derive(Deserialize)]
struct WorktreeRemoveIn {
    repoRoot: String,
    worktreePath: String,
    #[serde(default)]
    force: bool,
}

#[derive(Serialize)]
struct WorktreeRemoveOut {
    ok: bool,
}

fn worktree_remove(input: WorktreeRemoveIn) -> Result<WorktreeRemoveOut, String> {
    let repo_root = PathBuf::from(input.repoRoot);
    let worktree_path = PathBuf::from(input.worktreePath);
    let mut args = vec![
        "-C".to_string(),
        repo_root.display().to_string(),
        "worktree".to_string(),
        "remove".to_string(),
    ];
    if input.force {
        args.push("--force".to_string());
    }
    args.push(worktree_path.display().to_string());
    let out = run_git(&args, None)?;
    if !out.ok {
        return Err(if out.stderr.is_empty() {
            format!("git worktree remove failed: {}", worktree_path.display())
        } else {
            out.stderr
        });
    }
    Ok(WorktreeRemoveOut { ok: true })
}

fn normalize_repo_path(p: &str) -> Option<String> {
    let posix = p.replace('\\', "/");
    if posix.starts_with('/') {
        return None;
    }
    let bytes = posix.as_bytes();
    if bytes.len() >= 3 {
        let c0 = bytes[0];
        let c1 = bytes[1];
        let c2 = bytes[2];
        if (c0 as char).is_ascii_alphabetic() && c1 == b':' && c2 == b'/' {
            return None;
        }
    }

    let mut stack: Vec<&str> = Vec::new();
    for part in posix.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if stack.is_empty() {
                return None;
            }
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    if stack.is_empty() {
        return None;
    }
    Some(stack.join("/"))
}

fn touched_files_from_unified_diff(patch_path: &Path) -> Result<Vec<(String, bool)>, String> {
    let f = File::open(patch_path)
        .map_err(|e| format!("failed to open patch for parsing: {}: {e}", patch_path.display()))?;
    let reader = BufReader::new(f);

    let mut files: Vec<(String, bool)> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("failed reading patch: {e}"))?;
        if !line.starts_with("diff --git ") {
            continue;
        }
        // Typical: diff --git a/foo/bar b/foo/bar
        let rest = line.trim_start_matches("diff --git ").trim();
        let mut it = rest.split_whitespace();
        let a = it.next();
        let b = it.next();
        if a.is_none() || b.is_none() {
            continue;
        }
        let a_path = a.unwrap().strip_prefix("a/").unwrap_or(a.unwrap());
        let b_path = b.unwrap().strip_prefix("b/").unwrap_or(b.unwrap());

        let file = if b_path == "/dev/null" { a_path } else { b_path };
        match normalize_repo_path(file) {
            Some(n) => {
                if seen.contains(&n) {
                    continue;
                }
                seen.insert(n.clone());
                files.push((n, false));
            }
            None => {
                files.push((file.to_string(), true));
            }
        }
    }
    Ok(files)
}

fn ensure_owned(touched_files: &[(String, bool)], allowed_prefixes: &[String]) -> Result<(), String> {
    let mut allowed: Vec<String> = allowed_prefixes
        .iter()
        .map(|p| p.replace('\\', "/"))
        .filter(|p| !p.trim().is_empty())
        .map(|p| if p.ends_with('/') { p } else { format!("{p}/") })
        .collect();
    allowed.sort();
    allowed.dedup();

    if allowed.is_empty() {
        return Err("allowedPathPrefixes is empty".to_string());
    }

    let mut violations: Vec<String> = Vec::new();
    for (path, invalid) in touched_files.iter() {
        if *invalid {
            violations.push(format!("invalid path in patch: {path}"));
            continue;
        }
        let mut ok = false;
        for prefix in allowed.iter() {
            let base = prefix.trim_end_matches('/');
            if path == base || path.starts_with(prefix) {
                ok = true;
                break;
            }
        }
        if !ok {
            violations.push(format!("unauthorized path: {path}"));
        }
    }

    if !violations.is_empty() {
        return Err(format!(
            "patch ownership check failed:\n- {}",
            violations.join("\n- ")
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct PatchApplyIn {
    worktreePath: String,
    patchPath: String,
    allowedPathPrefixes: Vec<String>,
}

#[derive(Serialize)]
struct PatchApplyOut {
    touchedFiles: Vec<String>,
}

fn patch_apply(input: PatchApplyIn) -> Result<PatchApplyOut, String> {
    let worktree_path = PathBuf::from(input.worktreePath);
    let patch_path = PathBuf::from(input.patchPath);

    let patch_text = fs::read_to_string(&patch_path)
        .map_err(|e| format!("failed to read patch file: {}: {e}", patch_path.display()))?;
    let trimmed = patch_text.trim();
    if trimmed.is_empty() {
        return Ok(PatchApplyOut {
            touchedFiles: Vec::new(),
        });
    }

    let touched = touched_files_from_unified_diff(&patch_path)?;
    if touched.is_empty() {
        return Err("patch has content but no \"diff --git\" headers (not a unified diff?)".to_string());
    }
    ensure_owned(&touched, &input.allowedPathPrefixes)?;

    let args_check = vec![
        "-C".to_string(),
        worktree_path.display().to_string(),
        "apply".to_string(),
        "--check".to_string(),
        patch_path.display().to_string(),
    ];
    let out = run_git(&args_check, None)?;
    if !out.ok {
        return Err(if out.stderr.is_empty() {
            "git apply --check failed".to_string()
        } else {
            out.stderr
        });
    }

    let args_apply = vec![
        "-C".to_string(),
        worktree_path.display().to_string(),
        "apply".to_string(),
        patch_path.display().to_string(),
    ];
    let out2 = run_git(&args_apply, None)?;
    if !out2.ok {
        return Err(if out2.stderr.is_empty() {
            "git apply failed".to_string()
        } else {
            out2.stderr
        });
    }

    Ok(PatchApplyOut {
        touchedFiles: touched
            .into_iter()
            .filter(|(_, invalid)| !*invalid)
            .map(|(p, _)| p)
            .collect(),
    })
}

#[derive(Deserialize)]
struct CommitAllIn {
    repoRoot: String,
    message: String,
}

#[derive(Serialize)]
struct CommitAllOut {
    sha: String,
}

fn commit_all(input: CommitAllIn) -> Result<CommitAllOut, String> {
    let repo_root = PathBuf::from(input.repoRoot);

    let out_add = run_git(
        &vec![
            "-C".to_string(),
            repo_root.display().to_string(),
            "add".to_string(),
            "-A".to_string(),
        ],
        None,
    )?;
    if !out_add.ok {
        return Err(out_add.stderr.is_empty().then(|| "git add failed".to_string()).unwrap_or(out_add.stderr));
    }

    let out_commit = run_git(
        &vec![
            "-C".to_string(),
            repo_root.display().to_string(),
            "commit".to_string(),
            "-m".to_string(),
            input.message,
        ],
        None,
    )?;
    if !out_commit.ok {
        return Err(out_commit.stderr.is_empty().then(|| "git commit failed".to_string()).unwrap_or(out_commit.stderr));
    }

    let out_sha = run_git(
        &vec![
            "-C".to_string(),
            repo_root.display().to_string(),
            "rev-parse".to_string(),
            "HEAD".to_string(),
        ],
        None,
    )?;
    if !out_sha.ok {
        return Err(out_sha.stderr.is_empty().then(|| "git rev-parse HEAD failed".to_string()).unwrap_or(out_sha.stderr));
    }

    Ok(CommitAllOut {
        sha: out_sha.stdout.trim().to_string(),
    })
}

#[derive(Deserialize)]
struct VerifyCmdIn {
    name: String,
    command: String,
}

#[derive(Deserialize)]
struct VerifyRunIn {
    worktreePath: String,
    outDir: String,
    commands: Vec<VerifyCmdIn>,
}

#[derive(Serialize)]
struct VerifyCmdOut {
    name: String,
    command: String,
    ok: bool,
    exitCode: i32,
    outputPath: String,
}

#[derive(Serialize)]
struct VerifySummaryOut {
    version: i32,
    ranAt: String,
    commands: Vec<VerifyCmdOut>,
    ok: bool,
}

fn safe_name(name: &str) -> String {
    let mut out = String::new();
    let mut last_was_dash = false;
    for ch in name.trim().to_lowercase().chars() {
        let allowed = ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-';
        if allowed {
            out.push(ch);
            last_was_dash = false;
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "command".to_string()
    } else {
        out
    }
}

fn run_shell_command_to_file(command: &str, cwd: &Path, output_path: &Path) -> Result<i32, String> {
    let file = File::create(output_path)
        .map_err(|e| format!("failed to create output file {}: {e}", output_path.display()))?;
    let file_err = file
        .try_clone()
        .map_err(|e| format!("failed to clone output file handle: {e}"))?;

    let mut cmd;
    if cfg!(windows) {
        cmd = Command::new("cmd");
        cmd.arg("/C").arg(command);
    } else {
        cmd = Command::new("sh");
        cmd.arg("-lc").arg(command);
    }
    let status = cmd
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(file_err))
        .status()
        .map_err(|e| format!("failed to run command: {e}"))?;

    Ok(status.code().unwrap_or(1))
}

fn verify_run(input: VerifyRunIn) -> Result<VerifySummaryOut, String> {
    let worktree = PathBuf::from(input.worktreePath);
    let out_dir = PathBuf::from(input.outDir);
    fs::create_dir_all(&out_dir)
        .map_err(|e| format!("failed to create verify outDir {}: {e}", out_dir.display()))?;

    let mut results: Vec<VerifyCmdOut> = Vec::new();
    let mut all_ok = true;

    for c in input.commands.iter() {
        let name_safe = safe_name(&c.name);
        let output_path = out_dir.join(format!("{name_safe}.txt"));

        let exit_code = run_shell_command_to_file(&c.command, &worktree, &output_path)?;
        let ok = exit_code == 0;
        if !ok {
            all_ok = false;
        }

        results.push(VerifyCmdOut {
            name: c.name.clone(),
            command: c.command.clone(),
            ok,
            exitCode: exit_code,
            outputPath: output_path.display().to_string(),
        });
    }

    let summary = VerifySummaryOut {
        version: 1,
        ranAt: now_iso(),
        commands: results,
        ok: all_ok,
    };

    // Write evidence file.
    let summary_path = out_dir.join("summary.json");
    let mut f = File::create(&summary_path)
        .map_err(|e| format!("failed to write {}: {e}", summary_path.display()))?;
    let json = serde_json::to_string_pretty(&summary)
        .map_err(|e| format!("failed to serialize verify summary: {e}"))?;
    f.write_all(json.as_bytes())
        .and_then(|_| f.write_all(b"\n"))
        .map_err(|e| format!("failed to write verify summary: {e}"))?;

    Ok(summary)
}

fn usage() {
    eprintln!(
        r#"ecc-kernel

Usage:
  ecc-kernel <command>   (JSON input on stdin; JSON output on stdout)

Commands:
  worktree.ensure
  worktree.remove
  patch.apply
  git.commit_all
  verify.run
"#
    );
}

fn real_main() -> Result<(), String> {
  let mut args = std::env::args();
  let _ = args.next();
  let cmd = match args.next() {
    Some(c) => c,
    None => {
      usage();
      return Err("missing command".to_string());
    }
  };

  if cmd == "--help" || cmd == "-h" {
    usage();
    return Ok(());
  }

  if cmd == "--version" || cmd == "-V" {
    println!("ecc-kernel {}", env!("CARGO_PKG_VERSION"));
    return Ok(());
  }

  let result = match cmd.as_str() {
    "worktree.ensure" => {
      let input: WorktreeEnsureIn = read_stdin_json()?;
      let out = worktree_ensure(input)?;
      write_stdout_json(&out)
    }
    "worktree.remove" => {
      let input: WorktreeRemoveIn = read_stdin_json()?;
      let out = worktree_remove(input)?;
      write_stdout_json(&out)
    }
    "patch.apply" => {
      let input: PatchApplyIn = read_stdin_json()?;
      let out = patch_apply(input)?;
      write_stdout_json(&out)
    }
    "git.commit_all" => {
      let input: CommitAllIn = read_stdin_json()?;
      let out = commit_all(input)?;
      write_stdout_json(&out)
    }
    "verify.run" => {
      let input: VerifyRunIn = read_stdin_json()?;
      let out = verify_run(input)?;
      write_stdout_json(&out)
    }
    _ => Err(format!("unknown command: {cmd}")),
  };

  result
}

fn main() -> ExitCode {
  match real_main() {
    Ok(()) => ExitCode::from(0),
    Err(err) => {
      if err != "missing command" {
        eprintln!("{err}");
      }
      ExitCode::from(1)
    }
  }
}
