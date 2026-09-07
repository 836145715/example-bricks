<script>
import { defineAsyncComponent } from "vue";
import { Config_ToolModal, OpenTools } from "../config/toolModal.js";
import { Events } from "../../brickly/runtime.js";

const Cert = defineAsyncComponent(() => import("../SideBar/Settings/Cert.vue"));
const ReplaceBody = defineAsyncComponent(() => import("../SideBar/Settings/ReplaceBody.vue"));
const Theme = defineAsyncComponent(() => import("./Theme/theme.vue"));
const CertInstall = defineAsyncComponent(() => import("./Other/CertInstall/CertInstall.vue"));
const DiffText = defineAsyncComponent(() => import("./Other/DiffText/diffeditor.vue"));

const TITLES = {
  Cert: "请求证书设置",
  ReplaceBody: "请求拦截/数据替换设置",
  "主题调色": "主题调色",
  "证书安装": "证书安装",
  "文本对比": "文本对比",
  "脚本代码": "脚本代码",
  "MCP能力描述": "MCP能力描述",
};

const IFRAME_TOOLS = new Set(["脚本代码", "MCP能力描述"]);
const SCROLL_TOOLS = new Set(["主题调色", "证书安装"]);
const WIDE_TOOLS = new Set(["Cert", "ReplaceBody", "脚本代码", "MCP能力描述", "文本对比"]);

function parseToolEvent(data) {
  if (Array.isArray(data)) {
    return { name: data[0], open: data[1], args: data[2] };
  }
  if (data && typeof data === "object") {
    return { name: data.name, open: data.open, args: data.args };
  }
  return { name: data, open: true, args: "" };
}

export default {
  components: { Cert, ReplaceBody, Theme, CertInstall, DiffText },
  setup() {
    return { toolModal: Config_ToolModal };
  },
  computed: {
    modal() {
      return this.toolModal;
    },
    open() {
      return !!(this.modal && this.modal.open && this.modal.name);
    },
    name() {
      return (this.modal && this.modal.name) || "";
    },
    args() {
      return (this.modal && this.modal.args) || "";
    },
    title() {
      return TITLES[this.name] || this.name;
    },
    isIframe() {
      return IFRAME_TOOLS.has(this.name);
    },
    isScroll() {
      return SCROLL_TOOLS.has(this.name);
    },
    isWide() {
      return WIDE_TOOLS.has(this.name);
    },
    iframeSrc() {
      const a = String(this.args || "");
      return a.startsWith("http") ? a : "about:blank";
    },
  },
  watch: {
    open: {
      immediate: true,
      handler() {
        this.syncChrome();
      },
    },
  },
  mounted() {
    this._offTool = Events.On("__tool", (evt) => {
      const p = parseToolEvent(evt && evt.data);
      OpenTools(p.name, p.open, p.args);
    });
    this._onKey = (e) => {
      if (!this.open) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener("keydown", this._onKey, true);
  },
  beforeUnmount() {
    if (typeof this._offTool === "function") this._offTool();
    window.removeEventListener("keydown", this._onKey, true);
    this.clearChrome();
  },
  methods: {
    close() {
      OpenTools(this.name, false, this.args);
    },
    syncChrome() {
      if (this.open) {
        document.documentElement.setAttribute("data-sn-tool-modal", "");
        document.documentElement.style.setProperty("--el-popup-z-index", "40000");
        this.$nextTick(() => {
          this.$refs.panel && this.$refs.panel.focus();
        });
        return;
      }
      this.clearChrome();
    },
    clearChrome() {
      document.documentElement.removeAttribute("data-sn-tool-modal");
      document.documentElement.style.removeProperty("--el-popup-z-index");
    },
  },
};
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="sn-tool-modal" role="presentation">
      <div class="sn-tool-modal-backdrop" @click="close"></div>
      <div
          class="sn-tool-modal-panel"
          :class="{ 'is-wide': isWide }"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          ref="panel"
      >
        <div class="sn-tool-modal-head">
          <span class="sn-tool-modal-title">{{ title }}</span>
          <button class="sn-tool-modal-close" type="button" aria-label="关闭" @click="close">×</button>
        </div>
        <div class="sn-tool-modal-body" :class="{ 'is-scroll': isScroll }">
          <Cert v-if="name === 'Cert'" embedded />
          <ReplaceBody v-else-if="name === 'ReplaceBody'" embedded />
          <Theme v-else-if="name === '主题调色'" embedded />
          <div v-else-if="name === '证书安装'" class="sn-tool-fill">
            <CertInstall />
          </div>
          <DiffText v-else-if="name === '文本对比'" />
          <iframe
              v-else-if="isIframe"
              class="sn-tool-modal-iframe"
              :src="iframeSrc"
              :title="title"
          />
        </div>
      </div>
    </div>
  </teleport>
</template>

<style>
.sn-tool-modal {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sn-tool-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.sn-tool-modal-panel {
  position: relative;
  z-index: 1;
  width: min(980px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  background: var(--ag-background-color, #171515);
  color: var(--ag-cell-text-color, #eee);
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  outline: none;
}
.sn-tool-modal-panel.is-wide {
  width: min(1180px, calc(100vw - 24px));
  height: min(820px, calc(100vh - 24px));
}
.sn-tool-modal-head {
  height: 36px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  padding: 0 6px 0 14px;
  background: var(--ag-header-background-color, rgba(0, 0, 0, 0.18));
  border-bottom: 1px solid rgba(128, 128, 128, 0.28);
}
.sn-tool-modal-title {
  flex: 1;
  font-size: 13px;
  text-align: center;
  user-select: none;
}
.sn-tool-modal-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
}
.sn-tool-modal-close:hover {
  background: rgba(128, 128, 128, 0.25);
}
.sn-tool-modal-body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.sn-tool-modal-body.is-scroll {
  overflow: auto;
}
.sn-tool-fill {
  width: 100%;
  height: 100%;
  overflow: auto;
}
.sn-tool-modal-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
.ag-popup {
  z-index: 50000;
}
.sn-tool-embed {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  overflow: hidden;
}
.sn-tool-page {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  overflow: hidden;
}
</style>
