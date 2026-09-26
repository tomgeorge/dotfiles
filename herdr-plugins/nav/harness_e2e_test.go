//go:build e2e

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// harness runs a real herdr server and client, isolated under a temp HOME,
// inside a private tmux server so tests can press real keys. WezTerm
// handoffs go to outer.log (HERDR_NAV_OUTER_LOG) instead of a GUI.
type harness struct {
	t        *testing.T
	home     string
	repo     string // dotfiles checkout
	env      []string
	tmux     string // tmux -L socket name
	outerLog string
	accent   string // "r;g;b" the client marks focus with; see clientView
}

const (
	pollEvery  = 20 * time.Millisecond
	waitFor    = 2 * time.Second
	startupFor = 20 * time.Second
)

// cmdTimeout bounds every external command, so a hung herdr, tmux or nvim
// fails the poll that called it instead of hanging the run: poll can only
// check its deadline between calls.
const cmdTimeout = 5 * time.Second

// command runs name with a timeout and returns stdout, and stderr folded
// into the error. env nil means inherit (only tmux, which gets an explicit
// env -i for herdr itself).
func command(env []string, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = env
	cmd.WaitDelay = time.Second // don't wait on pipes a killed child left open
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return out, fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, bytes.TrimSpace(stderr.Bytes()))
	}
	return out, nil
}

func (h *harness) tmuxCmd(args ...string) ([]byte, error) {
	return command(nil, "tmux", append([]string{"-L", h.tmux}, args...)...)
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	for _, bin := range []string{"herdr", "tmux"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skipf("%s not on PATH; skipping e2e", bin)
		}
	}
	repo, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	navBin := filepath.Join(repo, "herdr-plugins/nav/bin")
	if _, err := os.Stat(filepath.Join(navBin, "herdr-nav")); err != nil {
		t.Fatalf("herdr-nav not built; run `make test-e2e` (it builds first): %v", err)
	}

	// /tmp, not t.TempDir(): unix socket paths are capped at 104 bytes on
	// macOS and herdr puts its sockets under HOME.
	home, err := os.MkdirTemp("/tmp", "hn")
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{
		t:        t,
		home:     home,
		repo:     repo,
		tmux:     fmt.Sprintf("hn-%d", os.Getpid()),
		outerLog: filepath.Join(home, "outer.log"),
	}
	// Built from scratch, never inherited: a test started inside herdr has
	// the live HERDR_SOCKET_PATH, which would drive the real session.
	h.env = []string{
		"HOME=" + home,
		"USER=" + os.Getenv("USER"),
		"TERM=xterm-256color",
		"LANG=en_US.UTF-8",
		"PATH=" + testPath(navBin),
		"HERDR_NAV_OUTER_LOG=" + h.outerLog,
		"HERDR_SOCKET_PATH=" + h.socket(),
	}
	t.Cleanup(h.close)

	h.writeConfig()
	// Where link.sh puts it. Pane shells are login shells whose profile
	// resets PATH, so nvim's nav.lua finds herdr-nav here, as it does for real.
	localBin := filepath.Join(home, ".local/bin")
	if err := os.MkdirAll(localBin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(navBin, "herdr-nav"), filepath.Join(localBin, "herdr-nav")); err != nil {
		t.Fatal(err)
	}
	h.herdr("plugin", "link", filepath.Join(repo, "herdr-plugins/nav"))

	// The client (and so the server it spawns) gets h.env only.
	args := []string{"-f", "/dev/null", "new-session", "-d", "-x", "160", "-y", "40", "--", "/usr/bin/env", "-i"}
	args = append(append(args, h.env...), "herdr")
	if _, err := h.tmuxCmd(args...); err != nil {
		t.Fatalf("start tmux: %v", err)
	}
	h.poll("herdr server to start", startupFor, func() bool {
		_, err := h.tryHerdr("pane", "list")
		return err == nil
	})
	// The server answering doesn't mean the client is drawing and reading
	// keys yet; keys sent before then are lost.
	h.poll("herdr client to draw", startupFor, func() bool { return strings.Contains(h.clientScreen(), "spaces") })
	// With one tab, its label's background must be the focus colour.
	h.poll("focus colour", waitFor, func() bool {
		labels := h.tabLabels()
		if len(labels) == 1 && labels[0].bg != "" {
			h.accent = labels[0].bg
		}
		return h.accent != ""
	})
	// Warm up: the first exec of a freshly built binary is slow on macOS
	// (signature checks), which would land on the first latency check. In
	// a lone pane this is a no-op move that hands off; drop the record.
	h.herdr("plugin", "action", "invoke", "tg.nav.left")
	h.poll("warm-up", waitFor, func() bool { return len(h.outer()) > 0 })
	h.resetOuter()
	if !strings.HasPrefix(h.socket(), home+"/") {
		t.Fatalf("socket %s is outside the test HOME %s", h.socket(), home)
	}
	if _, err := os.Stat(h.socket()); err != nil {
		t.Fatalf("server isn't listening under the test HOME: %v", err)
	}
	return h
}

// testPath is a PATH with herdr-nav first, then the directories of the
// tools the tests run, so the test's own PATH order doesn't leak in.
func testPath(navBin string) string {
	dirs := []string{navBin}
	seen := map[string]bool{navBin: true}
	for _, bin := range []string{"herdr", "tmux", "nvim", "fzf", "sh", "seq"} {
		if p, err := exec.LookPath(bin); err == nil && !seen[filepath.Dir(p)] {
			seen[filepath.Dir(p)] = true
			dirs = append(dirs, filepath.Dir(p))
		}
	}
	return strings.Join(append(dirs, "/usr/bin", "/bin"), ":")
}

func (h *harness) socket() string { return filepath.Join(h.home, ".config/herdr/herdr.sock") }

// writeConfig uses the real [keys] and [[keys.command]] from
// herdr/config.toml, so the tests cover the bindings actually shipped.
func (h *harness) writeConfig() {
	src, err := os.ReadFile(filepath.Join(h.repo, "herdr/config.toml"))
	if err != nil {
		h.t.Fatal(err)
	}
	var out bytes.Buffer
	out.WriteString("onboarding = false\n\n[terminal]\ndefault_shell = \"sh\"\n\n")
	header := regexp.MustCompile(`^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$`)
	keep := false
	sc := bufio.NewScanner(bytes.NewReader(src))
	for sc.Scan() {
		line := sc.Text()
		if m := header.FindStringSubmatch(line); m != nil {
			name := strings.TrimSpace(m[1])
			keep = name == "keys" || name == "keys.command"
		}
		if keep {
			out.WriteString(line + "\n")
		}
	}
	dir := filepath.Join(h.home, ".config/herdr")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		h.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), out.Bytes(), 0o644); err != nil {
		h.t.Fatal(err)
	}
	if got := h.herdr("config", "check"); !bytes.Contains(got, []byte("ok")) {
		h.t.Fatalf("config check: %s", got)
	}
}

// at returns the harness reporting to t, for use inside a subtest: calling
// Fatal on the parent's t from a subtest is an error.
func (h *harness) at(t *testing.T) *harness {
	c := *h
	c.t = t
	t.Cleanup(func() {
		if t.Failed() {
			c.dump()
		}
	})
	return &c
}

func (h *harness) close() {
	if os.Getenv("HN_KEEP") != "" {
		h.t.Logf("HN_KEEP set; left running. Attach, then detach with ctrl+b d:\n"+
			"  tmux -L %[2]s attach\n"+
			"Query it (env -i keeps your live herdr out of it):\n"+
			"  env -i HOME=%[1]s PATH=\"$PATH\" herdr pane list\n"+
			"Clean up:\n"+
			"  env -i HOME=%[1]s PATH=\"$PATH\" herdr server stop; tmux -L %[2]s kill-server; rm -rf %[1]s",
			h.home, h.tmux)
		return
	}
	// Every step runs even if an earlier one fails or times out.
	if _, err := h.tryHerdr("server", "stop"); err != nil {
		h.t.Logf("cleanup: %v (a herdr server under %s may be left running)", err, h.home)
	}
	if _, err := h.tmuxCmd("kill-server"); err != nil {
		h.t.Logf("cleanup: %v", err)
	}
	// kill-server leaves the socket file behind; tmux keeps it in
	// $TMUX_TMPDIR (default /tmp)/tmux-<uid>/<name>.
	dir := os.Getenv("TMUX_TMPDIR")
	if dir == "" {
		dir = "/tmp"
	}
	_ = os.Remove(filepath.Join(dir, fmt.Sprintf("tmux-%d", os.Getuid()), h.tmux))
	_ = os.RemoveAll(h.home)
}

// dump logs what the screen and plugin log looked like, for failures.
func (h *harness) dump() {
	screen, _ := h.tmuxCmd("capture-pane", "-p")
	h.t.Logf("screen:\n%s", screen)
	var r struct {
		Logs []struct {
			ActionID string `json:"action_id"`
			Status   string
			Stderr   string
		}
	}
	h.herdrJSON(&r, "plugin", "log", "list", "--plugin", "tg.nav")
	if n := len(r.Logs); n > 5 {
		r.Logs = r.Logs[n-5:]
	}
	for _, l := range r.Logs {
		h.t.Logf("tg.nav %s: %s %s", l.ActionID, l.Status, strings.TrimSpace(l.Stderr))
	}
}

func (h *harness) tryHerdr(args ...string) ([]byte, error) {
	out, err := command(h.env, "herdr", args...)
	if err != nil {
		return out, err
	}
	// The CLI reports API errors in the JSON body with exit status 0.
	var body struct {
		Error *struct{ Code, Message string } `json:"error"`
	}
	if json.Unmarshal(out, &body) == nil && body.Error != nil {
		return out, fmt.Errorf("herdr %s: %s: %s", strings.Join(args, " "), body.Error.Code, body.Error.Message)
	}
	return out, nil
}

func (h *harness) herdr(args ...string) []byte {
	h.t.Helper()
	out, err := h.tryHerdr(args...)
	if err != nil {
		h.t.Fatal(err)
	}
	return out
}

// herdrJSON runs a herdr command and decodes its "result" into v.
func (h *harness) herdrJSON(v any, args ...string) {
	h.t.Helper()
	var body struct {
		Result json.RawMessage `json:"result"`
	}
	out := h.herdr(args...)
	if err := json.Unmarshal(out, &body); err != nil {
		h.t.Fatalf("herdr %s: %v: %s", strings.Join(args, " "), err, out)
	}
	if err := json.Unmarshal(body.Result, v); err != nil {
		h.t.Fatalf("herdr %s: %v: %s", strings.Join(args, " "), err, body.Result)
	}
}

// keys presses keys in the herdr client, through herdr's keybindings.
func (h *harness) keys(keys ...string) {
	h.t.Helper()
	if _, err := h.tmuxCmd(append([]string{"send-keys"}, keys...)...); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) poll(what string, limit time.Duration, cond func() bool) time.Duration {
	h.t.Helper()
	start := time.Now()
	for !cond() {
		if time.Since(start) > limit {
			h.t.Fatalf("timed out after %v waiting for %s", limit, what)
		}
		time.Sleep(pollEvery)
	}
	return time.Since(start)
}

type paneInfo struct {
	PaneID      string `json:"pane_id"`
	TabID       string `json:"tab_id"`
	WorkspaceID string `json:"workspace_id"`
	Focused     bool   `json:"focused"`
}

func (h *harness) focused() string {
	h.t.Helper()
	var r struct{ Panes []paneInfo }
	h.herdrJSON(&r, "pane", "list")
	for _, p := range r.Panes {
		if p.Focused {
			return p.PaneID
		}
	}
	return ""
}

func (h *harness) waitFocused(pane string) time.Duration {
	h.t.Helper()
	return h.poll("focus on "+pane, waitFor, func() bool { return h.focused() == pane })
}

func (h *harness) focusedTab() string {
	h.t.Helper()
	var r struct{ Panes []paneInfo }
	h.herdrJSON(&r, "pane", "list")
	for _, p := range r.Panes {
		if p.Focused {
			return p.TabID
		}
	}
	return ""
}

// outer returns the WezTerm handoffs recorded so far.
func (h *harness) outer() []string {
	b, err := os.ReadFile(h.outerLog)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		h.t.Fatal(err)
	}
	var lines []string
	for _, l := range strings.Split(string(b), "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines
}

func (h *harness) resetOuter() {
	if err := os.Remove(h.outerLog); err != nil && !os.IsNotExist(err) {
		h.t.Fatal(err)
	}
}

// Focus changes go through the herdr client's own keys, never the API: a
// keybinding runs with the client's idea of what's focused, which lags an
// API-driven change, so a key pressed right after `tab focus` acts on the
// old tab. A person watching the screen never hits that; a test does.

// newTab opens a tab with one fresh pane and returns both. Each case starts
// with one so nothing carries over from the last.
func (h *harness) newTab() (string, string) {
	h.t.Helper()
	before := h.focused()
	// The tab is created when its name prompt is saved (Escape cancels).
	h.keys("C-a", "c")
	h.poll("tab name prompt", waitFor, func() bool { return strings.Contains(h.clientScreen(), "new tab") })
	h.keys("Enter")
	h.poll("new tab", waitFor, func() bool { return h.focused() != before })
	h.waitClient(len(h.tabs()), 0)
	h.resetOuter()
	return h.focusedTab(), h.focused()
}

// splitRight splits the focused pane and returns the new, focused pane.
func (h *harness) splitRight() string {
	h.t.Helper()
	before := h.focused()
	h.keys("C-a", "v")
	h.poll("split", waitFor, func() bool { return h.focused() != before })
	// Splitting the rightmost pane (all these tests do) adds a new rightmost.
	h.waitClient(h.focusedTabNumber(), h.panesInFocusedTab()-1)
	return h.focused()
}

func (h *harness) panesInFocusedTab() int {
	h.t.Helper()
	tab := h.focusedTab()
	var r struct{ Panes []paneInfo }
	h.herdrJSON(&r, "pane", "list")
	n := 0
	for _, p := range r.Panes {
		if p.TabID == tab {
			n++
		}
	}
	return n
}

// focusDir moves focus with herdr's own prefix+h/j/k/l, not tg.nav, to the
// pane at index (left to right).
func (h *harness) focusDir(key, want string, index int) {
	h.t.Helper()
	h.keys("C-a", key)
	h.waitFocused(want)
	h.waitClient(h.focusedTabNumber(), index)
}

func (h *harness) focusedTabNumber() int {
	h.t.Helper()
	for _, t := range h.tabs() {
		if t.Focused {
			return t.Number
		}
	}
	h.t.Fatal("no focused tab")
	return 0
}

type tabInfo struct {
	TabID   string `json:"tab_id"`
	Number  int    `json:"number"`
	Focused bool   `json:"focused"`
}

// tabs lists the focused workspace's tabs in order.
func (h *harness) tabs() []tabInfo {
	h.t.Helper()
	var r struct{ Tabs []tabInfo }
	h.herdrJSON(&r, "tab", "list")
	return r.Tabs
}

// focusTabNumber switches with herdr's prefix+<n>.
func (h *harness) focusTabNumber(n int) string {
	h.t.Helper()
	var want string
	for _, t := range h.tabs() {
		if t.Number == n {
			want = t.TabID
		}
	}
	if want == "" {
		h.t.Fatalf("no tab %d", n)
	}
	h.keys("C-a", fmt.Sprint(n))
	h.poll(fmt.Sprintf("tab %d", n), waitFor, func() bool { return h.focusedTab() == want })
	h.waitClient(n, 0)
	return want
}

// run types a command into pane's shell and waits for name to be in front.
func (h *harness) run(pane, command, name string) {
	h.t.Helper()
	h.herdr("pane", "run", pane, command)
	h.poll(name+" in "+pane, 5*time.Second, func() bool {
		var r struct {
			ProcessInfo struct {
				Foreground []struct{ Name, Argv0 string } `json:"foreground_processes"`
			} `json:"process_info"`
		}
		h.herdrJSON(&r, "pane", "process-info", "--pane", pane)
		for _, p := range r.ProcessInfo.Foreground {
			// argv0 too: nix's coreutils is one binary named "coreutils".
			if p.Name == name || filepath.Base(p.Argv0) == name {
				return true
			}
		}
		return false
	})
}

// screen is pane's visible text.
func (h *harness) screen(pane string) string {
	h.t.Helper()
	return string(h.herdr("pane", "read", pane, "--source", "visible"))
}

// clientScreen is what the herdr client draws, including its mode bar.
func (h *harness) clientScreen() string {
	h.t.Helper()
	out, err := h.tmuxCmd("capture-pane", "-p")
	if err != nil {
		h.t.Fatal(err)
	}
	return string(out)
}

type tabLabel struct {
	n  int
	bg string
}

// tabLabels are the numbered tab labels on the client's first line.
func (h *harness) tabLabels() []tabLabel {
	h.t.Helper()
	out, err := h.tmuxCmd("capture-pane", "-p", "-e")
	if err != nil {
		h.t.Fatal(err)
	}
	first, _, _ := strings.Cut(string(out), "\n")
	var labels []tabLabel
	for _, seg := range sgrSegments(first) {
		text := strings.TrimSpace(seg.text)
		if n, err := strconv.Atoi(text); err == nil {
			labels = append(labels, tabLabel{n, seg.bg})
		}
	}
	return labels
}

// clientView reads what the herdr client shows as focused: the 1-based
// number of the active tab, and the 0-based index (left to right) of the
// focused pane. Both are drawn in the focus colour (h.accent, read at
// startup): the active tab's label background, and the focused pane's top
// border. Only side-by-side layouts are read, which is all these tests
// build; a lone pane has no border and counts as index 0.
func (h *harness) clientView() (tab, pane int) {
	h.t.Helper()
	for _, l := range h.tabLabels() {
		if l.bg == h.accent {
			tab = l.n
		}
	}
	out, err := h.tmuxCmd("capture-pane", "-p", "-e")
	if err != nil {
		h.t.Fatal(err)
	}
	lines := strings.SplitN(string(out), "\n", 3)
	if len(lines) < 2 {
		return tab, -1
	}
	pane = -1
	i := 0
	for _, seg := range sgrSegments(lines[1]) {
		for _, r := range seg.text {
			if r != '┌' {
				continue
			}
			if seg.fg == h.accent {
				pane = i
			}
			i++
		}
	}
	if i == 0 {
		pane = 0
	}
	return tab, pane
}

type sgrSegment struct{ fg, bg, text string }

var sgr = regexp.MustCompile(`\x1b\[([0-9;]*)m`)

// sgrSegments splits a line of terminal output into runs of text with the
// truecolor foreground and background in effect ("r;g;b", or "").
func sgrSegments(line string) []sgrSegment {
	var segs []sgrSegment
	var fg, bg string
	last := 0
	for _, m := range sgr.FindAllStringSubmatchIndex(line, -1) {
		if m[0] > last {
			segs = append(segs, sgrSegment{fg, bg, line[last:m[0]]})
		}
		last = m[1]
		params := strings.Split(line[m[2]:m[3]], ";")
		for j := 0; j < len(params); j++ {
			switch params[j] {
			case "", "0":
				fg, bg = "", ""
			case "39":
				fg = ""
			case "49":
				bg = ""
			case "38", "48":
				if j+4 < len(params) && params[j+1] == "2" {
					c := strings.Join(params[j+2:j+5], ";")
					if params[j] == "38" {
						fg = c
					} else {
						bg = c
					}
					j += 4
				}
			}
		}
	}
	if last < len(line) {
		segs = append(segs, sgrSegment{fg, bg, line[last:]})
	}
	return segs
}

// waitClient waits until the client shows tab (1-based) and pane (0-based
// index) as focused. Keybindings run with the client's view, so a key sent
// before this acts on what the client showed before.
func (h *harness) waitClient(tab, pane int) {
	h.t.Helper()
	var gotTab, gotPane int
	defer func() {
		if h.t.Failed() {
			h.t.Logf("client showed tab %d pane %d", gotTab, gotPane)
		}
	}()
	h.poll(fmt.Sprintf("client to show tab %d pane %d", tab, pane), waitFor, func() bool {
		gotTab, gotPane = h.clientView()
		return gotTab == tab && gotPane == pane
	})
}

// nvim starts nvim in pane with the real nvim/lua/nav.lua mapped to
// ctrl+hjkl, listening on a socket so tests can read its state.
func (h *harness) nvim(pane, extra string) *nvimRemote {
	h.t.Helper()
	if _, err := exec.LookPath("nvim"); err != nil {
		h.t.Skip("nvim not on PATH")
	}
	init := filepath.Join(h.home, "init.lua")
	if _, err := os.Stat(init); err != nil {
		lua := fmt.Sprintf(`package.path = %q .. "/nvim/lua/?.lua;" .. package.path
for _, k in ipairs({ "h", "j", "k", "l" }) do
  vim.keymap.set("n", "<C-" .. k .. ">", function() require("nav").go(k) end)
end
`, h.repo)
		if err := os.WriteFile(init, []byte(lua), 0o644); err != nil {
			h.t.Fatal(err)
		}
	}
	n := &nvimRemote{h: h, socket: filepath.Join(h.home, "nv-"+strings.ReplaceAll(pane, ":", "-"))}
	h.run(pane, fmt.Sprintf("nvim -u %s --listen %s %s", init, n.socket, extra), "nvim")
	h.poll("nvim socket", 5*time.Second, func() bool { _, err := n.tryExpr("1"); return err == nil })
	return n
}

type nvimRemote struct {
	h      *harness
	socket string
}

func (n *nvimRemote) tryExpr(expr string) (string, error) {
	out, err := command(n.h.env, "nvim", "--server", n.socket, "--remote-expr", expr)
	return strings.TrimSpace(string(out)), err
}

func (n *nvimRemote) expr(expr string) string {
	n.h.t.Helper()
	out, err := n.tryExpr(expr)
	if err != nil {
		n.h.t.Fatalf("nvim %s: %v", expr, err)
	}
	return out
}

func (n *nvimRemote) send(keys string) {
	n.h.t.Helper()
	if _, err := command(n.h.env, "nvim", "--server", n.socket, "--remote-send", keys); err != nil {
		n.h.t.Fatal(err)
	}
}

func (n *nvimRemote) waitWin(want string) {
	n.h.t.Helper()
	n.h.poll("nvim window "+want, waitFor, func() bool { return n.expr("winnr()") == want })
}
