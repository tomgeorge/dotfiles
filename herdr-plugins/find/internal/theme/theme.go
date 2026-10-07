// Package theme resolves the colours Herdr is drawing with from its own
// config, so a plugin's popup agrees with Herdr's sidebar instead of
// carrying a second palette.
//
// The builtins, name aliases and colour parsing follow Herdr 0.9.1
// (src/app/state.rs, src/config/theme.rs); the choice of tokens follows
// herdrkit, MIT, github.com/joshrwolf/dots.
package theme

import (
	"image/color"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/BurntSushi/toml"
)

// Indicators is Herdr's status glyph set, ui.status_indicators.
type Indicators string

const (
	Dots    Indicators = "dots"
	Symbols Indicators = "symbols"
)

// Theme is the subset of a Herdr palette a popup draws with. Each comment
// names the Herdr token the colour comes from.
type Theme struct {
	Background color.Color // panel_bg
	Text       color.Color // text: primary text
	Muted      color.Color // overlay0: secondary text, rules and counts
	Accent     color.Color // accent
	Blue       color.Color // blue
	Green      color.Color // green
	Red        color.Color // red
	Yellow     color.Color // yellow
	Teal       color.Color // teal
	Selection  color.Color // selection_bg
	Matched    color.Color // mauve: matched characters
	Indicators Indicators
}

// reset is the terminal's default colour: no foreground set, no background
// drawn.
var reset color.Color = lipgloss.NoColor{}

func rgb(r, g, b uint8) color.Color { return color.RGBA{R: r, G: g, B: b, A: 0xff} }

func builtin(bg, text, overlay0, accent, blue, green, red, yellow, teal, selection, mauve color.Color) Theme {
	return Theme{
		Background: bg, Text: text, Muted: overlay0, Accent: accent,
		Blue: blue, Green: green, Red: red, Yellow: yellow, Teal: teal,
		Selection: selection, Matched: mauve, Indicators: Dots,
	}
}

// builtins are Herdr's built-in themes, keyed by canonical name. Generated
// from Herdr 0.9.1's src/app/state.rs; re-check when Herdr is upgraded.
var builtins = map[string]Theme{
	"catppuccin":       builtin(rgb(24, 24, 37), rgb(205, 214, 244), rgb(108, 112, 134), rgb(137, 180, 250), rgb(137, 180, 250), rgb(166, 227, 161), rgb(243, 139, 168), rgb(249, 226, 175), rgb(148, 226, 213), rgb(49, 50, 68), rgb(203, 166, 247)),
	"catppuccin-latte": builtin(rgb(239, 241, 245), rgb(76, 79, 105), rgb(156, 160, 176), rgb(30, 102, 245), rgb(30, 102, 245), rgb(64, 160, 43), rgb(210, 15, 57), rgb(223, 142, 29), rgb(23, 146, 153), rgb(189, 208, 245), rgb(136, 57, 239)),
	"terminal": {
		Background: reset,
		Text:       reset,
		Muted:      lipgloss.White,
		Accent:     lipgloss.Blue,
		Blue:       lipgloss.Blue,
		Green:      lipgloss.Green,
		Red:        lipgloss.BrightRed,
		Yellow:     lipgloss.Yellow,
		Teal:       lipgloss.Cyan,
		Selection:  reset,
		Matched:    lipgloss.White,
		Indicators: Dots,
	},
	"tokyo-night":     builtin(rgb(26, 27, 38), rgb(192, 202, 245), rgb(86, 95, 137), rgb(122, 162, 247), rgb(122, 162, 247), rgb(158, 206, 106), rgb(247, 118, 142), rgb(224, 175, 104), rgb(125, 207, 255), rgb(45, 54, 80), rgb(187, 154, 247)),
	"tokyo-night-day": builtin(rgb(225, 226, 231), rgb(55, 96, 191), rgb(137, 144, 179), rgb(46, 125, 233), rgb(46, 125, 233), rgb(88, 117, 57), rgb(245, 42, 101), rgb(140, 108, 62), rgb(17, 140, 116), rgb(182, 202, 231), rgb(120, 71, 189)),
	"dracula":         builtin(rgb(40, 42, 54), rgb(248, 248, 242), rgb(98, 114, 164), rgb(189, 147, 249), rgb(139, 233, 253), rgb(80, 250, 123), rgb(255, 85, 85), rgb(241, 250, 140), rgb(139, 233, 253), rgb(70, 63, 93), rgb(255, 121, 198)),
	"nord":            builtin(rgb(46, 52, 64), rgb(236, 239, 244), rgb(76, 86, 106), rgb(136, 192, 208), rgb(129, 161, 193), rgb(163, 190, 140), rgb(191, 97, 106), rgb(235, 203, 139), rgb(143, 188, 187), rgb(64, 80, 93), rgb(180, 142, 173)),
	"gruvbox":         builtin(rgb(40, 40, 40), rgb(235, 219, 178), rgb(146, 131, 116), rgb(215, 153, 33), rgb(131, 165, 152), rgb(184, 187, 38), rgb(251, 73, 52), rgb(250, 189, 47), rgb(142, 192, 124), rgb(75, 63, 39), rgb(211, 134, 155)),
	"gruvbox-light":   builtin(rgb(251, 241, 199), rgb(60, 56, 54), rgb(146, 131, 116), rgb(7, 102, 120), rgb(7, 102, 120), rgb(121, 116, 14), rgb(157, 0, 6), rgb(181, 118, 20), rgb(66, 123, 88), rgb(235, 219, 178), rgb(143, 63, 113)),
	"one-dark":        builtin(rgb(40, 44, 52), rgb(171, 178, 191), rgb(92, 99, 112), rgb(97, 175, 239), rgb(97, 175, 239), rgb(152, 195, 121), rgb(224, 108, 117), rgb(229, 192, 123), rgb(86, 182, 194), rgb(51, 70, 89), rgb(198, 120, 221)),
	"one-light":       builtin(rgb(250, 250, 250), rgb(56, 58, 66), rgb(160, 161, 167), rgb(64, 120, 242), rgb(64, 120, 242), rgb(80, 161, 79), rgb(228, 86, 73), rgb(193, 132, 1), rgb(1, 132, 188), rgb(205, 219, 248), rgb(166, 38, 164)),
	"solarized":       builtin(rgb(0, 43, 54), rgb(147, 161, 161), rgb(88, 110, 117), rgb(38, 139, 210), rgb(38, 139, 210), rgb(133, 153, 0), rgb(220, 50, 47), rgb(181, 137, 0), rgb(42, 161, 152), rgb(8, 62, 85), rgb(211, 54, 130)),
	"solarized-light": builtin(rgb(253, 246, 227), rgb(101, 123, 131), rgb(147, 161, 161), rgb(38, 139, 210), rgb(38, 139, 210), rgb(133, 153, 0), rgb(220, 50, 47), rgb(181, 137, 0), rgb(42, 161, 152), rgb(201, 220, 223), rgb(211, 54, 130)),
	"kanagawa":        builtin(rgb(31, 31, 40), rgb(220, 215, 186), rgb(114, 113, 105), rgb(126, 156, 216), rgb(126, 156, 216), rgb(118, 148, 106), rgb(195, 64, 67), rgb(192, 163, 110), rgb(127, 180, 202), rgb(50, 56, 75), rgb(149, 127, 184)),
	"kanagawa-lotus":  builtin(rgb(242, 236, 188), rgb(84, 84, 100), rgb(160, 156, 172), rgb(77, 105, 155), rgb(77, 105, 155), rgb(111, 137, 78), rgb(200, 64, 83), rgb(119, 113, 63), rgb(78, 140, 162), rgb(220, 213, 172), rgb(98, 76, 131)),
	"rose-pine":       builtin(rgb(25, 23, 36), rgb(224, 222, 244), rgb(110, 106, 134), rgb(196, 167, 231), rgb(49, 116, 143), rgb(49, 116, 143), rgb(235, 111, 146), rgb(246, 193, 119), rgb(156, 207, 216), rgb(59, 52, 75), rgb(196, 167, 231)),
	"rose-pine-dawn":  builtin(rgb(250, 244, 237), rgb(70, 66, 97), rgb(152, 147, 165), rgb(144, 122, 169), rgb(40, 105, 131), rgb(40, 105, 131), rgb(180, 99, 122), rgb(234, 157, 52), rgb(86, 148, 159), rgb(242, 233, 225), rgb(144, 122, 169)),
	"vesper":          builtin(rgb(26, 26, 26), rgb(255, 255, 255), rgb(92, 92, 92), rgb(255, 199, 153), rgb(176, 176, 176), rgb(153, 255, 228), rgb(255, 128, 128), rgb(255, 199, 153), rgb(102, 221, 204), rgb(35, 35, 35), rgb(255, 209, 168)),
}

// aliases maps every name Herdr accepts to its canonical name.
var aliases = map[string]string{
	"catppuccin": "catppuccin", "catppuccin-mocha": "catppuccin",
	"catppuccin-latte": "catppuccin-latte", "latte": "catppuccin-latte", "light": "catppuccin-latte",
	"terminal":    "terminal",
	"tokyo-night": "tokyo-night", "tokyonight": "tokyo-night",
	"tokyo-night-day": "tokyo-night-day", "tokyo-day": "tokyo-night-day", "tokyonight-day": "tokyo-night-day",
	"dracula": "dracula",
	"nord":    "nord",
	"gruvbox": "gruvbox", "gruvbox-dark": "gruvbox",
	"gruvbox-light": "gruvbox-light",
	"one-dark":      "one-dark", "onedark": "one-dark",
	"one-light": "one-light", "onelight": "one-light",
	"solarized": "solarized", "solarized-dark": "solarized",
	"solarized-light": "solarized-light",
	"kanagawa":        "kanagawa",
	"kanagawa-lotus":  "kanagawa-lotus", "lotus": "kanagawa-lotus",
	"rose-pine": "rose-pine", "rosepine": "rose-pine",
	"rose-pine-dawn": "rose-pine-dawn", "rosepine-dawn": "rose-pine-dawn", "dawn": "rose-pine-dawn",
	"vesper": "vesper",
}

// Named returns a built-in theme by any name Herdr accepts.
func Named(name string) (Theme, bool) {
	key := strings.NewReplacer(" ", "-", "_", "-").Replace(strings.ToLower(name))
	t, ok := builtins[aliases[key]]
	return t, ok
}

// Default is Herdr's default theme, Catppuccin Mocha.
func Default() Theme { return builtins["catppuccin"] }

// Load reads Herdr's config. A missing, unreadable or invalid config falls
// back to the default theme rather than failing: a popup that refused to
// draw over a config mistake would be worse than one in the default colours.
func Load() Theme {
	path := configPath()
	if path == "" {
		return Default()
	}
	text, err := os.ReadFile(path)
	if err != nil {
		return Default()
	}
	return Parse(string(text))
}

// Parse resolves a theme from the text of a Herdr config.toml.
func Parse(text string) Theme {
	var cfg config
	if _, err := toml.Decode(text, &cfg); err != nil {
		return Default()
	}
	return cfg.resolve()
}

// configPath is where Herdr reads its config. Herdr passes
// HERDR_CONFIG_PATH to plugins; the rest covers running outside Herdr.
func configPath() string {
	if p := os.Getenv("HERDR_CONFIG_PATH"); p != "" {
		return p
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "herdr", "config.toml")
}

type config struct {
	Theme struct {
		// AutoSwitch, DarkName and LightName aren't read: the popup can't
		// tell which appearance Herdr picked, so it follows Name.
		Name   *string `toml:"name"`
		Custom custom  `toml:"custom"`
	} `toml:"theme"`
	UI struct {
		StatusIndicators Indicators `toml:"status_indicators"`
		// ui.accent is Herdr's older accent setting. Herdr treats its
		// default, "cyan", as unset, and theme.custom.accent wins over it.
		Accent *string `toml:"accent"`
	} `toml:"ui"`
}

type custom struct {
	Accent    *string `toml:"accent"`
	PanelBg   *string `toml:"panel_bg"`
	Selection *string `toml:"selection_bg"`
	Overlay0  *string `toml:"overlay0"`
	Text      *string `toml:"text"`
	Mauve     *string `toml:"mauve"`
	Green     *string `toml:"green"`
	Yellow    *string `toml:"yellow"`
	Red       *string `toml:"red"`
	Blue      *string `toml:"blue"`
	Teal      *string `toml:"teal"`
}

func (c config) resolve() Theme {
	t := Default()
	if c.Theme.Name != nil {
		if named, ok := Named(*c.Theme.Name); ok {
			t = named
		}
	}
	cu := c.Theme.Custom
	for _, o := range []struct {
		value *string
		role  *color.Color
	}{
		{cu.Accent, &t.Accent},
		{cu.PanelBg, &t.Background},
		{cu.Selection, &t.Selection},
		{cu.Overlay0, &t.Muted},
		{cu.Text, &t.Text},
		{cu.Mauve, &t.Matched},
		{cu.Green, &t.Green},
		{cu.Yellow, &t.Yellow},
		{cu.Red, &t.Red},
		{cu.Blue, &t.Blue},
		{cu.Teal, &t.Teal},
	} {
		if o.value != nil {
			*o.role = ParseColor(*o.value)
		}
	}
	if a := c.UI.Accent; a != nil && *a != "cyan" && cu.Accent == nil {
		t.Accent = ParseColor(*a)
	}
	if c.UI.StatusIndicators == Symbols {
		t.Indicators = Symbols
	}
	return t
}

// named are the colour names Herdr accepts, as ANSI indices the way ratatui
// numbers them: its "gray" is ANSI 7 and its "white" ANSI 15.
var named = map[string]color.Color{
	"black":  lipgloss.Black,
	"red":    lipgloss.Red,
	"green":  lipgloss.Green,
	"yellow": lipgloss.Yellow, "blue": lipgloss.Blue,
	"magenta": lipgloss.Magenta, "purple": lipgloss.Magenta,
	"cyan": lipgloss.Cyan, "gray": lipgloss.White, "grey": lipgloss.White,
	"darkgray": lipgloss.BrightBlack, "darkgrey": lipgloss.BrightBlack,
	"lightred": lipgloss.BrightRed, "lightgreen": lipgloss.BrightGreen,
	"lightyellow": lipgloss.BrightYellow, "lightblue": lipgloss.BrightBlue,
	"lightmagenta": lipgloss.BrightMagenta, "lightcyan": lipgloss.BrightCyan,
	"white": lipgloss.BrightWhite,
}

// ParseColor parses a colour the way Herdr does: #rgb, #rrggbb, rgb(r,g,b),
// a name, or reset/default/none/transparent. Anything else is cyan, Herdr's
// own fallback, so a typo looks the same here as in the sidebar.
func ParseColor(s string) color.Color {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "reset", "default", "none", "transparent":
		return reset
	}
	if hex, ok := strings.CutPrefix(s, "#"); ok {
		if c, ok := parseHex(hex); ok {
			return c
		}
	}
	if inner, ok := strings.CutPrefix(s, "rgb("); ok {
		if inner, ok := strings.CutSuffix(inner, ")"); ok {
			if parts := strings.Split(inner, ","); len(parts) == 3 {
				var v [3]uint8
				valid := true
				for i, p := range parts {
					n, err := strconv.ParseUint(strings.TrimSpace(p), 10, 8)
					valid = valid && err == nil
					v[i] = uint8(n)
				}
				if valid {
					return rgb(v[0], v[1], v[2])
				}
			}
		}
	}
	if c, ok := named[s]; ok {
		return c
	}
	return lipgloss.Cyan
}

func parseHex(hex string) (color.Color, bool) {
	switch len(hex) {
	case 6:
		n, err := strconv.ParseUint(hex, 16, 32)
		if err != nil {
			return nil, false
		}
		return rgb(uint8(n>>16), uint8(n>>8), uint8(n)), true
	case 3:
		n, err := strconv.ParseUint(hex, 16, 16)
		if err != nil {
			return nil, false
		}
		return rgb(uint8(n>>8&0xf)*17, uint8(n>>4&0xf)*17, uint8(n&0xf)*17), true
	}
	return nil, false
}
