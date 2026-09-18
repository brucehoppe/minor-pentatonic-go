// Minor Pentatonic Practice Desk
//
// Coded by Bruce Hoppe.
//
// A single self-contained executable: the whole interactive practice desk is
// embedded in the binary and served on localhost only.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// version is stamped at build time with -ldflags "-X main.version=..."
var version = "dev"

// author is shown on the page, in the startup log and at /about.
const author = "Bruce Hoppe"

const appName = "Minor Pentatonic Practice Desk"

// A fixed port, so a second launch can find the first one instead of starting a
// rival copy on a random port. Packaged builds have no console, so "it is already
// running" has to be discovered over the network rather than told to the user.
const defaultAddr = "127.0.0.1:7534"

// Everything the browser is ever served — pages, styles, script, images and the two
// typefaces. The whole practice desk ships inside the executable, so a copied binary
// is a complete, working app with nothing to install and nothing to fetch from the
// network, including no webfont request at load time.
//
//go:embed web/*.html web/*.css web/*.js web/vendor/* web/assets/*.jpg web/assets/*.png web/assets/*.svg web/assets/fonts/*
var webFiles embed.FS

// embeddedWeb is the shipped site: the web/ directory, rooted so that "index.html"
// rather than "web/index.html" is the path a request asks for.
func embeddedWeb() fs.FS {
	content, err := fs.Sub(webFiles, "web")
	if err != nil {
		panic(err) // only possible if the embed directive above is malformed
	}
	return content
}

// devWeb reads the same files off disk instead. Because go:embed bakes the site in
// at compile time, editing a page otherwise means rebuilding to see the change;
// -dev serves the working copy so a reload is enough.
func devWeb() fs.FS { return os.DirFS("web") }

func appHandler(stop func()) http.Handler {
	return appHandlerFS(stop, embeddedWeb())
}

// contentSecurityPolicy lets the pages load only what the binary itself serves.
// Styles may be inline (the pages and generated markup use style attributes);
// scripts may not. Audio falls back to data: URIs of rendered WAVs, recorded takes
// play back from blob: URLs, and the Seven Licks page is framed by the practice
// desk, so framing stays same-origin.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob: data:; " +
	"object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"

func appHandlerFS(stop func(), content fs.FS) http.Handler {
	files := http.FileServer(http.FS(content))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		if r.URL.Path == "/favicon.ico" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path == "/quit" {
			// Packaged builds have no terminal to Ctrl-C, so the page offers a
			// Quit button. Requiring POST and a custom header means a browser
			// cannot be talked into this by a form on another site.
			if r.Method != http.MethodPost || r.Header.Get("X-Quit") != "1" {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			fmt.Fprintln(w, "stopped")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			go stop()
			return
		}
		if r.URL.Path == "/version" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			fmt.Fprintln(w, version)
			return
		}
		if r.URL.Path == "/about" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			fmt.Fprintf(w, "%s %s\nCoded by %s\n", appName, version, author)
			return
		}
		// The set of servable paths is whatever was embedded, so adding a page or
		// an image needs no change here. It is still a closed allowlist: the FS
		// contains only the files named in the go:embed directive, and Clean
		// resolves any ".." before the lookup.
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		if !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(content, name)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		// Embedded files have no modification time, so the file server cannot
		// answer conditional requests and re-sends everything on every load. The
		// assets never change within a build, so say so and let the browser keep
		// them; pages stay revalidated so a new build is picked up immediately.
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

// loopbackOnly refuses any request whose Host is not a loopback name. The server
// only listens on 127.0.0.1, but a hostile page can still reach it through DNS
// rebinding (a domain that re-resolves to 127.0.0.1 is same-origin with itself),
// and checking Host is what closes that door.
func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		if host != "localhost" && !isLoopbackIP(host) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopbackIP(host string) bool {
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func openBrowser(url string) error {
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command, args = "open", []string{url}
	case "windows":
		command, args = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default:
		command, args = "xdg-open", []string{url}
	}
	return exec.Command(command, args...).Start()
}

// alreadyServing reports whether our own app is the thing holding a port.
// Anything else on that port (or nothing at all) gives false.
func alreadyServing(url string) bool {
	client := &http.Client{Timeout: time.Second}
	resp, err := client.Get(url + "/about")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return resp.StatusCode == http.StatusOK && strings.Contains(string(body), appName)
}

// listen binds addr, falling back sensibly when the port is taken.
// A nil listener with a nil error means our app is already running at the
// returned URL and this process should just reopen it and exit.
func listen(addr string) (net.Listener, string, error) {
	l, err := net.Listen("tcp", addr)
	if err == nil {
		return l, "http://" + l.Addr().String(), nil
	}
	if !errors.Is(err, syscall.EADDRINUSE) {
		return nil, "", fmt.Errorf("listen: %w", err)
	}
	if url := "http://" + addr; alreadyServing(url) {
		return nil, url, nil
	}
	log.Printf("Port %s is in use by something else; taking a free one instead.", addr)
	if l, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
		return nil, "", fmt.Errorf("listen: %w", err)
	}
	return l, "http://" + l.Addr().String(), nil
}

// launchedFromBundle reports whether this process is the executable inside a macOS
// .app. Finder launches those through LaunchServices, which will not start a second
// copy of an app it already considers running — it tries to activate the first one
// instead, and an app with no windows can never satisfy that, which is what produces
// "You can't open the application because it is not responding".
//
// So the bundle's executable does not stay resident. It starts a detached server,
// opens the browser and exits, leaving LaunchServices nothing to re-activate. Every
// double-click then behaves the same way: the app opens, whether or not it was
// already serving.
func launchedFromBundle(exe string) bool {
	return runtime.GOOS == "darwin" && strings.Contains(exe, ".app/Contents/MacOS/")
}

// waitForServer blocks until the server answers, or the deadline passes.
func waitForServer(url string, limit time.Duration) bool {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if alreadyServing(url) {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

// launchDetached starts the server in the background if it is not already up, then
// opens the browser at it. It returns as soon as the page is reachable.
func launchDetached(exe, addr string) error {
	url := "http://" + addr
	if !alreadyServing(url) {
		devNull, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
		if err != nil {
			return fmt.Errorf("open %s: %w", os.DevNull, err)
		}
		defer devNull.Close()

		cmd := exec.Command(exe, "-serve", "-no-open", "-addr", addr)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = devNull, devNull, devNull
		detach(cmd)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("start server: %w", err)
		}
		if err := cmd.Process.Release(); err != nil {
			return fmt.Errorf("release server: %w", err)
		}
		if !waitForServer(url, 10*time.Second) {
			return fmt.Errorf("%s did not come up at %s", appName, url)
		}
	}
	return openBrowser(url)
}

func run(addr string, launch bool, dev bool) error {
	listener, url, err := listen(addr)
	if err != nil {
		return err
	}
	if listener == nil {
		// Already running. Bring the practice desk back rather than doing nothing,
		// which is what a second double-click should mean.
		log.Printf("%s is already running at %s — reopening it.", appName, url)
		if launch {
			if err := openBrowser(url); err != nil {
				log.Printf("Could not open a browser: %v", err)
			}
		}
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	content := embeddedWeb()
	if dev {
		content = devWeb()
		log.Printf("Development mode: serving ./web from disk, so a reload picks up edits.")
	}
	server := &http.Server{
		Handler:           loopbackOnly(appHandlerFS(stop, content)),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("%s %s — coded by %s", appName, version, author)
	log.Printf("Running at %s", url)
	if launch {
		if err := openBrowser(url); err != nil {
			log.Printf("Could not open a browser: %v", err)
		}
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func main() {
	addr := flag.String("addr", defaultAddr, "local address to listen on")
	noOpen := flag.Bool("no-open", false, "do not open the browser automatically")
	showVersion := flag.Bool("version", false, "print the version and exit")
	serve := flag.Bool("serve", false, "stay in the foreground and serve (the macOS app bundle uses this internally)")
	dev := flag.Bool("dev", false, "serve ./web from disk instead of the embedded copy, so edits show on reload")
	flag.Parse()
	if *showVersion {
		fmt.Printf("%s %s\nCoded by %s\n", appName, version, author)
		return
	}
	if exe, err := os.Executable(); err == nil && !*serve && launchedFromBundle(exe) {
		if err := launchDetached(exe, *addr); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := run(*addr, !*noOpen, *dev); err != nil {
		log.Fatal(err)
	}
}
