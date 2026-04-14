package proxy

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

const cubbitAPIBase = "https://api.eu00wi.cubbit.services"

// CubbitHandler returns an http.Handler that reverse-proxies /cubbit-proxy/* to
// the Cubbit API, stripping the /cubbit-proxy prefix before forwarding.
// Cookie domain/Secure rewriting is applied so the _refresh cookie works from HTTP.
func CubbitHandler() http.Handler {
	apiURL, _ := url.Parse(cubbitAPIBase)
	rp := httputil.NewSingleHostReverseProxy(apiURL)

	orig := rp.Director
	rp.Director = func(req *http.Request) {
		orig(req)
		// Strip /cubbit-proxy prefix
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/cubbit-proxy")
		if req.URL.RawPath != "" {
			req.URL.RawPath = strings.TrimPrefix(req.URL.RawPath, "/cubbit-proxy")
		}
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		req.URL.Host = apiURL.Host
		req.URL.Scheme = "https"
		req.Host = apiURL.Host
		// Remove Origin/Referer — Cubbit rejects requests with a browser origin
		req.Header.Del("Origin")
		req.Header.Del("Referer")
	}

	// Rewrite Set-Cookie so the _refresh cookie is usable by the browser:
	//   - drop Domain= restriction (defaults to current host)
	//   - drop Secure flag (app may run on plain HTTP)
	rp.ModifyResponse = func(resp *http.Response) error {
		rewriteCookies(resp)
		return nil
	}

	return rp
}

// ConsoleTenantHandler handles HEAD /cubbit-proxy/console-proxy/tenant-id?name=<tenant>
// It proxies to https://console.<tenant>.cubbit.eu/ to retrieve the x-cbt-tenant-id header.
func ConsoleTenantHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"tenant name required"}`))
		return
	}

	upstreamHost := fmt.Sprintf("console.%s.cubbit.eu", name)
	targetURL := &url.URL{Scheme: "https", Host: upstreamHost, Path: "/"}

	rp := httputil.NewSingleHostReverseProxy(targetURL)
	rp.Director = func(req *http.Request) {
		req.URL = &url.URL{Scheme: "https", Host: upstreamHost, Path: "/"}
		req.Host = upstreamHost
		req.Method = http.MethodHead
		req.Header.Del("Origin")
		req.Header.Del("Referer")
		req.Header.Set("Host", upstreamHost)
		req.Body = nil
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		rewriteCookies(resp)
		return nil
	}

	rp.ServeHTTP(w, r)
}

// rewriteCookies rewrites Set-Cookie headers on the upstream response:
//   - removes Domain= attribute (browser defaults to current host)
//   - removes Secure flag (needed for HTTP deployments)
func rewriteCookies(resp *http.Response) {
	cookies := resp.Header["Set-Cookie"]
	if len(cookies) == 0 {
		return
	}
	rewritten := make([]string, 0, len(cookies))
	for _, sc := range cookies {
		parts := strings.Split(sc, ";")
		filtered := parts[:0]
		for _, part := range parts {
			trimmed := strings.TrimSpace(strings.ToLower(part))
			if strings.HasPrefix(trimmed, "domain=") {
				continue
			}
			if trimmed == "secure" {
				continue
			}
			filtered = append(filtered, part)
		}
		rewritten = append(rewritten, strings.Join(filtered, ";"))
	}
	resp.Header["Set-Cookie"] = rewritten
}
