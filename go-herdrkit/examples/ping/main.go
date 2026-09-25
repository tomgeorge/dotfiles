// Command herdr-ping is a Herdr plugin action that pings the server and shows
// the reply as a toast.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

func main() {
	if err := run(); err != nil {
		// Herdr records stderr in the plugin log: herdr plugin log list --plugin go-herdrkit.ping
		fmt.Fprintln(os.Stderr, "herdr-ping:", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c, err := herdr.FromEnv()
	if err != nil {
		return err
	}

	pong, err := c.Ping(ctx)
	if err != nil {
		// Still try to surface the failure where the user pressed the key.
		_, _ = c.ShowNotification(ctx, herdr.Notification{Title: "herdr ping failed", Body: err.Error()})
		return err
	}

	n := herdr.Notification{Title: "herdr " + pong.Version, Body: describe(pong), Sound: herdr.SoundNone}
	fmt.Printf("%s: %s\n", n.Title, n.Body)

	res, err := c.ShowNotification(ctx, n)
	if err != nil {
		return fmt.Errorf("show notification: %w", err)
	}
	if !res.Shown {
		return fmt.Errorf("notification not shown: %s", res.Reason)
	}
	return nil
}

func describe(p herdr.Pong) string {
	s := fmt.Sprintf("protocol %d", p.Protocol)
	if p.Protocol != herdr.Protocol {
		s += fmt.Sprintf(" (go-herdrkit expects %d)", herdr.Protocol)
	}
	if caps := p.Capabilities; caps != nil {
		s += fmt.Sprintf(" · live handoff %s · health check %s", yesNo(caps.LiveHandoff), yesNo(caps.HealthCheck))
	}
	return s
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}
