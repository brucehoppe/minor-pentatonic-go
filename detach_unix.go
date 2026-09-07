//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// detach puts the child in its own session so it outlives the process that
// started it. The macOS app bundle relies on this: its executable starts the
// server, then exits.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
