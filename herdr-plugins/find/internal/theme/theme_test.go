package theme

import (
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"charm.land/lipgloss/v2"
)

func TestEmptyConfigIsTheDefault(t *testing.T) {
	if got := Parse(""); got != Default() {
		t.Errorf("Parse(\"\") = %+v, want the default", got)
	}
	if d := Default(); d.Background != rgb(24, 24, 37) || d.Indicators != Dots {
		t.Errorf("Default() = %+v, want Catppuccin Mocha with dots", d)
	}
}

func TestInvalidConfigIsTheDefault(t *testing.T) {
	if got := Parse("[theme\nname = "); got != Default() {
		t.Errorf("unparsable config = %+v, want the default", got)
	}
	if got := Parse(`theme = 3`); got != Default() {
		t.Errorf("mistyped config = %+v, want the default", got)
	}
}

func TestEveryAliasResolves(t *testing.T) {
	for alias, canonical := range aliases {
		got, ok := Named(alias)
		if !ok || got != builtins[canonical] {
			t.Errorf("Named(%q) = %v, want %s", alias, ok, canonical)
		}
	}
	if len(builtins) != 18 {
		t.Errorf("%d builtins, Herdr 0.9.1 has 18", len(builtins))
	}
	for name := range builtins {
		if aliases[name] != name {
			t.Errorf("palette %q has no alias to itself", name)
		}
	}
}

func TestNamesAreNormalised(t *testing.T) {
	for _, name := range []string{"Tokyo Night", "tokyo_night", "TOKYONIGHT"} {
		if got, ok := Named(name); !ok || got != builtins["tokyo-night"] {
			t.Errorf("Named(%q) didn't resolve to tokyo-night", name)
		}
	}
}

func TestNamedTheme(t *testing.T) {
	got := Parse("[theme]\nname = \"dracula\"\n")
	if got != builtins["dracula"] {
		t.Errorf("got %+v, want dracula", got)
	}
}

func TestUnknownThemeIsTheDefault(t *testing.T) {
	if got := Parse("[theme]\nname = \"no-such-theme\"\n"); got != Default() {
		t.Errorf("got %+v, want the default", got)
	}
}

func TestCustomColoursOverrideTheBase(t *testing.T) {
	got := Parse(`
[theme]
name = "nord"
[theme.custom]
accent = "#000001"
panel_bg = "#000002"
selection_bg = "#000003"
overlay0 = "rgb(0, 0, 4)"
text = "white"
mauve = "#abc"
green = "#000005"
yellow = "#000006"
red = "#000007"
blue = "#000008"
teal = "reset"
`)
	want := builtins["nord"]
	want.Accent = rgb(0, 0, 1)
	want.Background = rgb(0, 0, 2)
	want.Selection = rgb(0, 0, 3)
	want.Muted = rgb(0, 0, 4)
	want.Text = lipgloss.BrightWhite
	want.Matched = rgb(0xaa, 0xbb, 0xcc)
	want.Green = rgb(0, 0, 5)
	want.Yellow = rgb(0, 0, 6)
	want.Red = rgb(0, 0, 7)
	want.Blue = rgb(0, 0, 8)
	want.Teal = reset
	if got != want {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestLegacyAccent(t *testing.T) {
	for name, tt := range map[string]struct {
		config string
		want   color.Color
	}{
		"ui.accent applies":              {"[ui]\naccent = \"red\"\n", lipgloss.Red},
		"its default cyan is ignored":    {"[ui]\naccent = \"cyan\"\n", Default().Accent},
		"theme.custom.accent wins":       {"[ui]\naccent = \"red\"\n[theme.custom]\naccent = \"green\"\n", lipgloss.Green},
		"theme.custom.accent on its own": {"[theme.custom]\naccent = \"#000000\"\n", rgb(0, 0, 0)},
	} {
		if got := Parse(tt.config).Accent; got != tt.want {
			t.Errorf("%s: accent = %v, want %v", name, got, tt.want)
		}
	}
}

func TestParseColor(t *testing.T) {
	for in, want := range map[string]color.Color{
		"#1e1e2e":        rgb(0x1e, 0x1e, 0x2e),
		"  #1E1E2E ":     rgb(0x1e, 0x1e, 0x2e),
		"#fff":           rgb(0xff, 0xff, 0xff),
		"rgb(1, 2, 3)":   rgb(1, 2, 3),
		"rgb(1,2,3)":     rgb(1, 2, 3),
		"reset":          reset,
		"Transparent":    reset,
		"gray":           lipgloss.White,
		"darkgrey":       lipgloss.BrightBlack,
		"purple":         lipgloss.Magenta,
		"lightcyan":      lipgloss.BrightCyan,
		"#12345":         lipgloss.Cyan, // wrong length
		"#gggggg":        lipgloss.Cyan,
		"rgb(256, 0, 0)": lipgloss.Cyan,
		"rgb(1, 2)":      lipgloss.Cyan,
		"chartreuse":     lipgloss.Cyan,
		"":               lipgloss.Cyan,
	} {
		if got := ParseColor(in); got != want {
			t.Errorf("ParseColor(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestLoadReadsHerdrConfigPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte("[theme]\nname = \"vesper\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HERDR_CONFIG_PATH", path)
	if got := Load(); got != builtins["vesper"] {
		t.Errorf("Load() = %+v, want vesper", got)
	}
	t.Setenv("HERDR_CONFIG_PATH", filepath.Join(t.TempDir(), "missing.toml"))
	if got := Load(); got != Default() {
		t.Errorf("Load() with a missing file = %+v, want the default", got)
	}
}
