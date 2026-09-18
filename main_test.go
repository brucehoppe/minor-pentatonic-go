package main

import (
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAppHandlerServesEmbeddedPage(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if !strings.Contains(w.Body.String(), "Minor pentatonic") {
		t.Fatal("response does not contain the application page")
	}
	for _, feature := range []string{"Box 1 and Box 4 are the two landmarks", "Focus timer", "Tempo ladder", "Practice log", "12-bar blues", "Phrase generator", `href="app.css"`, `src="app.js"`} {
		if !strings.Contains(w.Body.String(), feature) {
			t.Errorf("response does not contain %q", feature)
		}
	}
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}

func TestAppHandlerRejectsUnknownPath(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/missing", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestAppHandlerServesSevenLicksLesson(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/seven-licks.html", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if !strings.Contains(w.Body.String(), "Seven<br>Licks") {
		t.Error("lesson page does not contain its title")
	}

	r = httptest.NewRequest(http.MethodGet, "/seven-licks.js", nil)
	w = httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("seven-licks.js: status = %d, want %d", w.Code, http.StatusOK)
	}
	for _, text := range []string{"The pull-off pair", "Chuck Berry double stops"} {
		if !strings.Contains(w.Body.String(), text) {
			t.Errorf("lesson script does not contain %q", text)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	for _, path := range []string{"/", "/seven-licks.html", "/app.js"} {
		w := httptest.NewRecorder()
		appHandler(func() {}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		csp := w.Header().Get("Content-Security-Policy")
		for _, want := range []string{"default-src 'self'", "script-src 'self';", "frame-ancestors 'self'"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s: CSP %q lacks %q", path, csp, want)
			}
		}
		if got := w.Header().Get("X-Frame-Options"); got != "SAMEORIGIN" {
			t.Errorf("%s: X-Frame-Options = %q", path, got)
		}
	}
}

// With script-src 'self', an inline <script> block would silently not run.
func TestPagesHaveNoInlineScripts(t *testing.T) {
	pages, err := fs.Glob(embeddedWeb(), "*.html")
	if err != nil || len(pages) == 0 {
		t.Fatalf("glob: %v %v", pages, err)
	}
	inline := regexp.MustCompile(`<script(\s[^>]*)?>\s*[^<\s]`)
	handler := regexp.MustCompile(`\son[a-z]+\s*=`)
	for _, page := range pages {
		body, err := fs.ReadFile(embeddedWeb(), page)
		if err != nil {
			t.Fatal(err)
		}
		if inline.Match(body) {
			t.Errorf("%s has an inline <script> the CSP will block", page)
		}
		if handler.Match(body) {
			t.Errorf("%s has an inline event handler the CSP will block", page)
		}
	}
}

func TestLoopbackOnlyRefusesForeignHosts(t *testing.T) {
	h := loopbackOnly(appHandler(func() {}))
	for host, want := range map[string]int{
		"127.0.0.1:7534":         http.StatusOK,
		"localhost:7534":         http.StatusOK,
		"[::1]:7534":             http.StatusOK,
		"127.0.0.1":              http.StatusOK,
		"attacker.example:7534":  http.StatusForbidden,
		"attacker.example":       http.StatusForbidden,
		"192.168.1.10:7534":      http.StatusForbidden,
		"localhost.attacker.com": http.StatusForbidden,
	} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Host = host
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Errorf("Host %q: status = %d, want %d", host, w.Code, want)
		}
	}
}

func TestAppHandlerServesTheStylesheetAndScript(t *testing.T) {
	for path, want := range map[string]string{
		"/app.css": "text/css",
		"/app.js":  "text/javascript",
	} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		appHandler(func() {}).ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want %d", path, w.Code, http.StatusOK)
		}
		if got := w.Header().Get("Content-Type"); !strings.HasPrefix(got, want) {
			t.Errorf("%s: Content-Type = %q, want %q", path, got, want)
		}
	}

	r := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	for _, feature := range []string{"function renderLand", "function renderChart", "function renderMajor", "All twelve keys"} {
		if !strings.Contains(w.Body.String(), feature) {
			t.Errorf("app.js does not contain %q", feature)
		}
	}
}

func TestAppHandlerServesThePageGraphic(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/assets/kaiju-guitar.png", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if got := w.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q", got)
	}
	if w.Body.Len() < 100_000 {
		t.Errorf("embedded image is unexpectedly small (%d bytes)", w.Body.Len())
	}
}

// The design names two typefaces. If they are not in the binary the page silently
// falls back to system fonts, which is what happened before they were embedded.
func TestAppHandlerServesTheEmbeddedFonts(t *testing.T) {
	css := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(css, httptest.NewRequest(http.MethodGet, "/app.css", nil))
	if n := strings.Count(css.Body.String(), "@font-face"); n < 6 {
		t.Fatalf("app.css declares %d @font-face rules, want at least 6", n)
	}
	licks := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(licks, httptest.NewRequest(http.MethodGet, "/seven-licks.html", nil))
	for _, family := range []string{"Work Sans", "Archivo Black", "Space Mono"} {
		if !strings.Contains(licks.Body.String(), `font-family:"`+family+`";`) {
			t.Errorf("seven-licks.html has no @font-face for %s", family)
		}
	}

	// every font either stylesheet asks for must actually be servable
	for _, m := range regexp.MustCompile(`url\((assets/fonts/[^)]+)\)`).FindAllStringSubmatch(css.Body.String()+licks.Body.String(), -1) {
		r := httptest.NewRequest(http.MethodGet, "/"+m[1], nil)
		w := httptest.NewRecorder()
		appHandler(func() {}).ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want %d", m[1], w.Code, http.StatusOK)
		}
		if got := w.Header().Get("Content-Type"); got != "font/woff2" {
			t.Errorf("%s: Content-Type = %q, want font/woff2", m[1], got)
		}
		if w.Body.Len() < 2000 {
			t.Errorf("%s: only %d bytes; that is not a font", m[1], w.Body.Len())
		}
		if got := w.Body.String()[:4]; got != "wOF2" {
			t.Errorf("%s: does not start with the woff2 signature", m[1])
		}
	}

	// the SIL Open Font Licence requires the licence to travel with the font
	for _, path := range []string{
		"/assets/fonts/OFL-DM-Mono.txt", "/assets/fonts/OFL-Bricolage-Grotesque.txt",
		"/assets/fonts/OFL-Work-Sans.txt", "/assets/fonts/OFL-Archivo-Black.txt", "/assets/fonts/OFL-Space-Mono.txt",
	} {
		w := httptest.NewRecorder()
		appHandler(func() {}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want %d", path, w.Code, http.StatusOK)
		}
		if !strings.Contains(w.Body.String(), "SIL Open Font License") {
			t.Errorf("%s does not carry the licence text", path)
		}
	}
}

// Assets never change within a build, so they are cacheable forever; pages must
// not be, or a new build would keep showing the old page.
func TestCacheHeaders(t *testing.T) {
	for path, want := range map[string]string{
		"/assets/kaiju-guitar.png": "public, max-age=31536000, immutable",
		"/":                        "no-cache",
		"/app.js":                  "no-cache",
	} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		appHandler(func() {}).ServeHTTP(w, r)
		if got := w.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control = %q, want %q", path, got, want)
		}
	}
}

// The allowlist is the embedded file set, so a traversal has to resolve to a real
// embedded file or be refused.
func TestAppHandlerRefusesTraversal(t *testing.T) {
	for _, path := range []string{"/../main.go", "/assets/../../main.go", "/web/index.html", "/assets/"} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		appHandler(func() {}).ServeHTTP(w, r)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want %d", path, w.Code, http.StatusNotFound)
		}
	}
}

func TestQuitEndpointNeedsPostAndHeader(t *testing.T) {
	for _, tc := range []struct {
		name   string
		method string
		header string
		want   int
	}{
		{"get is refused", http.MethodGet, "1", http.StatusMethodNotAllowed},
		{"cross-site form post is refused", http.MethodPost, "", http.StatusMethodNotAllowed},
		{"the page's own request is accepted", http.MethodPost, "1", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stopped := make(chan struct{})
			r := httptest.NewRequest(tc.method, "/quit", nil)
			if tc.header != "" {
				r.Header.Set("X-Quit", tc.header)
			}
			w := httptest.NewRecorder()
			appHandler(func() { close(stopped) }).ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d", w.Code, tc.want)
			}
			if tc.want != http.StatusOK {
				return
			}
			select {
			case <-stopped:
			case <-time.After(2 * time.Second):
				t.Fatal("accepted the request but never called stop")
			}
		})
	}
}

func TestVersionEndpointAndFlag(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/version", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if strings.TrimSpace(w.Body.String()) != version {
		t.Fatalf("body = %q, want %q", w.Body.String(), version)
	}
}

func TestAboutEndpointCreditsTheAuthor(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/about", nil)
	w := httptest.NewRecorder()
	appHandler(func() {}).ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	for _, want := range []string{"Coded by", author, version} {
		if !strings.Contains(w.Body.String(), want) {
			t.Errorf("/about does not mention %q; body = %q", want, w.Body.String())
		}
	}
	if author != "Bruce Hoppe" || strings.Contains(author, "@") {
		t.Errorf("author = %q, want a name with no email address", author)
	}
}

func TestListenFallsBackWhenThePortIsBusy(t *testing.T) {
	// something that is not us, squatting on a port
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "some other program")
	}))
	defer other.Close()
	addr := strings.TrimPrefix(other.URL, "http://")

	l, url, err := listen(addr)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if l == nil {
		t.Fatal("mistook another program for our own app")
	}
	defer l.Close()
	if url == "http://"+addr {
		t.Fatalf("should have moved to a free port, stayed on %s", url)
	}
}

func TestListenDetectsOurOwnAppOnThePort(t *testing.T) {
	ours := httptest.NewServer(appHandler(func() {}))
	defer ours.Close()
	addr := strings.TrimPrefix(ours.URL, "http://")

	l, url, err := listen(addr)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if l != nil {
		l.Close()
		t.Fatal("started a rival copy instead of finding the running one")
	}
	if url != "http://"+addr {
		t.Fatalf("url = %q, want the address already in use", url)
	}
}

func TestListenBindsAFreePort(t *testing.T) {
	l, url, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if l == nil {
		t.Fatal("no listener and no error")
	}
	defer l.Close()
	if !strings.HasPrefix(url, "http://127.0.0.1:") {
		t.Fatalf("url = %q", url)
	}
}

func TestDefaultAddrIsFixedSoASecondLaunchCanFindTheFirst(t *testing.T) {
	if !strings.HasPrefix(defaultAddr, "127.0.0.1:") {
		t.Fatalf("defaultAddr = %q, must stay on the loopback interface", defaultAddr)
	}
	if strings.HasSuffix(defaultAddr, ":0") {
		t.Fatal("defaultAddr must be a fixed port, or a second launch cannot find the first")
	}
}

func TestLaunchedFromBundleOnlyMatchesTheMacApp(t *testing.T) {
	bundle := "/Applications/Minor Pentatonic Practice Desk.app/Contents/MacOS/minor-pentatonic"
	plain := "/usr/local/bin/minor-pentatonic"
	if runtime.GOOS == "darwin" {
		if !launchedFromBundle(bundle) {
			t.Error("the executable inside the .app must use the launcher path")
		}
		if launchedFromBundle(plain) {
			t.Error("a plain command-line binary must not")
		}
		return
	}
	if launchedFromBundle(bundle) {
		t.Error("app bundles are a macOS concern only")
	}
}

func TestWaitForServerGivesUp(t *testing.T) {
	// nothing is listening here, so this must return false rather than block
	start := time.Now()
	if waitForServer("http://127.0.0.1:1", 300*time.Millisecond) {
		t.Fatal("reported a server that does not exist")
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("took %v to give up", elapsed)
	}
}

func TestWaitForServerFindsOurApp(t *testing.T) {
	ours := httptest.NewServer(appHandler(func() {}))
	defer ours.Close()
	if !waitForServer(ours.URL, 2*time.Second) {
		t.Fatal("did not recognise our own server")
	}
}

func TestBundleLauncherStartsServesAndIsRepeatable(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the launcher path is macOS only")
	}
	// build a real .app bundle around the binary and drive it the way Finder does
	dir := t.TempDir()
	exe := filepath.Join(dir, "App.app", "Contents", "MacOS", "minor-pentatonic")
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-o", exe, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	if !launchedFromBundle(exe) {
		t.Fatalf("%s should be recognised as a bundle executable", exe)
	}

	port, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	url := "http://" + addr
	defer func() { _, _ = http.Post(url+"/quit", "", nil) }()

	// Three launches in a row, exactly as three double-clicks would be. Each must
	// exit promptly; only the first may start a server.
	for i := 1; i <= 3; i++ {
		cmd := exec.Command(exe, "-addr", addr, "-no-open")
		done := make(chan error, 1)
		if err := cmd.Start(); err != nil {
			t.Fatalf("launch %d: %v", i, err)
		}
		go func() { done <- cmd.Wait() }()
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("launch %d exited with %v", i, err)
			}
		case <-time.After(15 * time.Second):
			_ = cmd.Process.Kill()
			t.Fatalf("launch %d never exited — the bundle executable must not stay resident", i)
		}
		if !alreadyServing(url) {
			t.Fatalf("after launch %d the practice desk is not being served", i)
		}
	}

	req, _ := http.NewRequest(http.MethodPost, url+"/quit", nil)
	req.Header.Set("X-Quit", "1")
	if _, err := http.DefaultClient.Do(req); err != nil {
		t.Fatalf("quit: %v", err)
	}
	// Quit answers first and shuts down gracefully after, so the server may still
	// answer briefly. Wait for it to go quiet rather than asking whether it ever
	// answers, which raced on slow CI machines.
	for deadline := time.Now().Add(5 * time.Second); alreadyServing(url); time.Sleep(50 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the background server ignored Quit")
		}
	}
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func TestFrontendFeatureSuite(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	cmd := exec.Command("node", "--test", "tests/app.test.mjs")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("frontend feature suite failed: %v\n%s", err, output)
	}
}
