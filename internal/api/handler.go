package api

import (
	"net/http"

	"ai-pipeline/internal/config"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	mgr *config.Manager
}

func NewHandler(mgr *config.Manager) *Handler {
	return &Handler{mgr: mgr}
}

func (h *Handler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, h.mgr.Get())
}

func (h *Handler) SaveConfig(c *gin.Context) {
	var cfg config.Config
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.mgr.Set(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}
