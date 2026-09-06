{
  # Pi Companion daemon — Nix packaging path (T43A3, plan.md §13 Phase 8
  # item 3; §15.4's "Docker and Nix checks when their paths change").
  #
  # This file is new, written for this repository's own npm-workspaces
  # build graph. It is not derived from, or a port of, any file under a
  # Paseo `packages/app` tree (plan.md §5).
  #
  # See packaging/nix/README.md before using this file — in particular its
  # "What has and has not been verified" section. No `nix` binary is
  # available in the environment that wrote this file: the `npmDepsHash`
  # below is a placeholder, and `packages.default` cannot build until a
  # real one is substituted by someone who can run `nix build`. The
  # `devShells.default` output does not depend on that hash and is the
  # more likely of the two to work as written on a first try.
  description = "Pi Companion daemon (T43A3 Nix packaging path)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Toolchain node-pty's install script needs when it falls back from
        # "try a prebuilt binary" to `node-gyp rebuild` (packaging/docker/
        # Dockerfile carries the identical apt package list — python3, make,
        # g++/gcc, git — for the same reason).
        nativeToolchain = [
          pkgs.nodejs_22
          pkgs.python3
          pkgs.gnumake
          pkgs.gcc
          pkgs.pkg-config
          pkgs.git
        ];
      in
      {
        # `nix develop .#packaging/nix` (or `cd packaging/nix && nix
        # develop`) drops into a shell with the same Node major version and
        # native-module build toolchain the Docker image's builder stage
        # uses, for building/testing this repository outside a container.
        # This output has no npmDepsHash to fill in and is the one most
        # likely to work unmodified — but it has still never actually been
        # entered with a real `nix develop`; see the README.
        devShells.default = pkgs.mkShell {
          packages = nativeToolchain;
        };

        # `nix build .#default` (from packaging/nix/) would produce a
        # `result/bin/picompanion-daemon` launcher, mirroring
        # packaging/docker/Dockerfile's build order: the server's own
        # dependency chain, the web app's dependency chain, the server's
        # `build:clean`, then `build:daemon-web-ui --skip-build` to bundle
        # the already-built apps/web/dist in (T43A1's invariant — never
        # reorder relative to build:clean, which wipes
        # packages/server/dist first).
        #
        # UNVERIFIED: `npmDepsHash` below is `pkgs.lib.fakeHash`, which
        # always fails on the first real build; `nix build` prints the
        # correct hash to substitute once you run it for real. Beyond
        # that: whether `sherpa-onnx-node`'s optional-dependency binary
        # fetch and `node-pty`'s `node-gyp rebuild` fallback succeed inside
        # Nix's sandboxed build (network is only available while
        # `npmDepsHash`'s fixed-output fetch runs, not during the build
        # phase itself) has never been checked. See the README.
        packages.default = pkgs.buildNpmPackage {
          pname = "picompanion-daemon";
          version = "0.3.0-beta.2";
          # ../.. from packaging/nix/ is the repository root — the same
          # build context packaging/docker/Dockerfile uses, for the same
          # reason: npm workspaces need every package.json + the lockfile
          # + every workspace's src/ in one place.
          src = ../..;

          npmDepsHash = pkgs.lib.fakeHash;

          nodejs = pkgs.nodejs_22;
          nativeBuildInputs = nativeToolchain;

          # buildNpmPackage's default build/install phases assume a single
          # `npm run build` in the src root; this repo needs the explicit
          # multi-workspace order below instead (see comment above), so
          # both default phases are replaced.
          dontNpmBuild = true;

          buildPhase = ''
            runHook preBuild
            npm run build --workspace=@picompanion/protocol
            npm run build --workspace=@picompanion/relay
            npm run build --workspace=@picompanion/highlight
            npm run build --workspace=@picompanion/client
            npm run build --workspace=@picompanion/design-tokens
            npm run build --workspace=@picompanion/frontend-core
            npm run build --workspace=@picompanion/web
            npm run build:clean --workspace=@picompanion/server
            npm run build:daemon-web-ui -- --skip-build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p "$out/lib/picompanion" "$out/bin"
            cp -r . "$out/lib/picompanion/"
            cat > "$out/bin/picompanion-daemon" <<EOF
            #!${pkgs.runtimeShell}
            exec ${pkgs.nodejs_22}/bin/node "$out/lib/picompanion/packages/server/dist/scripts/supervisor-entrypoint.js" "\$@"
            EOF
            chmod +x "$out/bin/picompanion-daemon"
            runHook postInstall
          '';
        };
      }
    );
}
