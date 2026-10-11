package llm

import (
	"encoding/json"
	"testing"
)

func TestMCPToolDisplayMetadataDoesNotChangeExecutableName(t *testing.T) {
	defs := []MCPToolDef{{
		ToolDef:     ToolDef{Name: "mcp_tavily_search_907c5f4438b5"},
		ServerID:    "mcp-tavily",
		DisplayName: "Tavily Search",
		Icon:        "Search",
	}}
	displays := mcpToolDisplayMap(defs)

	event := decorateToolDisplayEvent(SseEvent{
		Type: "tool_start",
		Name: "mcp_tavily_search_907c5f4438b5",
	}, displays)
	if event.Name != "mcp_tavily_search_907c5f4438b5" {
		t.Fatalf("tool name changed: %q", event.Name)
	}
	if event.ToolLabel != "Tavily Search" || event.ToolIcon != "Search" {
		t.Fatalf("display metadata = (%q, %q)", event.ToolLabel, event.ToolIcon)
	}

	blocks := decorateToolDisplayBlocks([]UnifiedBlock{{
		Kind:     "tool_call",
		ToolName: "mcp_tavily_search_907c5f4438b5",
	}}, displays)
	if blocks[0].ToolName != event.Name || blocks[0].ToolLabel != event.ToolLabel || blocks[0].ToolIcon != event.ToolIcon {
		t.Fatalf("decorated block = %#v", blocks[0])
	}
	if _, err := json.Marshal(blocks); err != nil {
		t.Fatalf("marshal decorated block: %v", err)
	}
}
