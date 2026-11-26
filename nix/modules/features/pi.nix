{ inputs, ... }:

let
  # MCP servers both Macs use. hey comes from the user's nix profile.
  sharedMcpServers = config: {
    hey = {
      command = "${config.home.profileDirectory}/bin/hey";
      args = [
        "mcp"
        "--read-only"
        "--domains"
        "threads,search,boxes"
      ];
      env.HEY_NONINTERACTIVE = "1";
    };
    hey-triage = {
      command = "${config.home.profileDirectory}/bin/hey";
      args = [
        "mcp"
        "--domains"
        "contacts"
      ];
      env.HEY_NONINTERACTIVE = "1";
    };
    todoist.url = "https://ai.todoist.net/mcp";
  };
in
{
  flake.modules.homeManager = {
    # pi, its settings, and its resources. Nix owns settings.json and mcp.json
    # read-only: pi can't persist /model, /settings, or `pi install` changes, so
    # make lasting changes here, and per-project ones in .pi/settings.json.
    pi =
      {
        config,
        lib,
        pkgs,
        ...
      }:
      let
        # From nixpkgs, not llm-agents: its pi is a compiled binary without the
        # npm package and type declarations that pi/extensions type-checks against.
        pi = pkgs.pi-coding-agent;
        json = pkgs.formats.json { };

        # Exact versions and commits: pi never updates a pinned package, so
        # packages change only when this list does.
        packages = [
          "npm:@gotgenes/pi-anthropic-auth@3.4.3"
          "npm:pi-google-workspace@1.0.1"
          "git:github.com/samber/cc-skills-golang@bb1d43d98a3f8ab639a0042f90d0ec524e39a477"
          # Rex-backed agents, side chats, and shell jobs. They need pi running inside Rex.
          "git:github.com/maxpaulus43/pi-rex-agents@ab7e5d71f002d34ff4dc331a20df5e6d65317d84"
          # Fork until maxpaulus43/pi-rex-btw#3 merges: upstream /btw passes a block ID as the Rex session.
          "git:github.com/tomgeorge/pi-rex-btw@f68ff18b1b1d85051e3fa30bac3d57e964703153"
          "git:github.com/maxpaulus43/pi-rex-shell@197d6d474b24e2488737bea4d7bb9490afa86486"
        ];

        settings = {
          # pi records the last version whose changelog it showed; it can't
          # write that here, so match the installed pi to keep it quiet.
          lastChangelogVersion = pi.version;
          theme = "dark";
          defaultProvider = "anthropic";
          defaultModel = "claude-opus-5-5";
          defaultThinkingLevel = "medium";
          defaultProjectTrust = "ask";
          enableInstallTelemetry = false;
          compaction.enabled = true;
          retry.enabled = true;
          skills = [ "~/.claude/skills" ];
          inherit packages;
        };

        # Extensions under development stay editable in the repo: live symlinks
        # into the checkout, not store copies, so an edit needs only /reload.
        # run-panel isn't listed: it's a library the others import by path.
        dotfiles = "${config.home.homeDirectory}/git/dotfiles";
        live = path: config.lib.file.mkOutOfStoreSymlink "${dotfiles}/${path}";
        extensions = [
          "advisor"
          "crew"
          "goal"
          "handoff"
          "hey-organize"
          "mcp-confirm"
          "rex-session"
          "subagent"
          "vi-mode"
          "watch"
        ];
      in
      {
        options.pi.mcpServers = lib.mkOption {
          type = lib.types.attrsOf json.type;
          default = { };
          description = "MCP servers for ~/.pi/agent/mcp.json. The file is left alone when empty.";
        };

        config = lib.mkMerge [
          {
            home.packages = [
              pi
              # ACP adapter, so Axel can run pi as a managed agent.
              pkgs.pi-acp
            ];
            home.file.".pi/agent/settings.json".source = json.generate "pi-settings.json" settings;
          }

          (lib.mkIf (config.pi.mcpServers != { }) {
            home.file.".pi/agent/mcp.json".source = json.generate "pi-mcp.json" {
              mcpServers = config.pi.mcpServers;
            };
          })

          # The live links need the dotfiles checkout, which only the Macs have.
          (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
            home.file = {
              ".pi/agent/AGENTS.md".source = live "pi/AGENTS.md";
              ".pi/agent/prompts".source = live "pi/prompts";
              # Agent definitions for pi-rex-agents; same names override its bundled ones.
              ".pi/agent/agents".source = live "pi/agents";
              ".pi/agent/retro".source = live "pi/retro";
              ".pi/agent/leader.json".source = live "pi/leader.json";

              # Skills. pi reads ~/.agents/skills itself and ~/.claude/skills
              # through `settings.skills`; Claude Code reads ~/.claude/skills too.
              # Link only skills/: ~/.agents also holds .skill-lock.json from the
              # skills installer.
              ".agents/skills".source = live "agents/skills";
              ".claude/skills".source = live "claude/skills";
            }
            // lib.listToAttrs (
              map (
                name: lib.nameValuePair ".pi/agent/extensions/${name}" { source = live "pi/extensions/${name}"; }
              ) extensions
            );
          })
        ];
      };

    # MCP servers per machine. Both need hm.pi, which hm.headless imports.
    piPersonal =
      { config, ... }:
      {
        pi.mcpServers = sharedMcpServers config // {
          fantastical.command = "/Applications/Fantastical.app/Contents/Helpers/FantasticalMCP.app/Contents/MacOS/FantasticalMCP";
          ynab = {
            command = "${config.home.profileDirectory}/bin/npx";
            args = [
              "-y"
              "ynab-mcp-server@0.7.1"
            ];
            env.YNAB_API_TOKEN = "!security find-generic-password -s ynab-api-token -w";
          };
        };
      };

    piWork =
      { config, ... }:
      {
        pi.mcpServers = sharedMcpServers config // {
          slack = {
            url = "https://mcp.slack.com/mcp";
            description = "Search and read Slack messages, threads, channels, canvases, and users";
            oauth = {
              clientId = "2308507492912.12258429359652";
              callbackUrl = "http://localhost:53682/callback";
            };
          };
          fantastical = {
            command = "${config.home.profileDirectory}/bin/uvx";
            args = [
              "--from"
              "git+https://github.com/tomgeorge/fantastical-mcp@fix/all-day-local-date"
              "fantastical-mcp"
            ];
          };
        };
      };
  };
}
