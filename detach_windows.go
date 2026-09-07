//go:build windows

package main

import "os/exec"

// detach is a no-op on Windows: the .exe is run directly rather than through an
// application bundle, so nothing needs to survive a launcher process.
func detach(cmd *exec.Cmd) {}
