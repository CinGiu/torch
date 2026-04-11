package web

import "embed"

// FS holds the built frontend files.
// The dist/ directory is populated during the Docker build.
//
//go:embed dist
var FS embed.FS
