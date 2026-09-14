import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `.pi/worktrees/*` holds scratch git worktrees that background jobs write in.
    // Each is a full checkout of this repo, so without this exclusion a run from the
    // repository root discovers every test file N+1 times and reports the copies as
    // failures: a job worktree has no built `packages/*/dist`, so every web test file
    // in it dies on `Failed to resolve entry for package "@picompanion/frontend-core"`.
    // Those are not real failures and the noise reads exactly like a broken merge.
    exclude: ["**/node_modules/**", "**/.dev/**", "**/dist/**", "**/.pi/**"],
  },
});
