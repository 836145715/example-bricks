<script>
import { openCaptureStream } from "../../capture/useCaptureStream";
import {Events} from "../../brickly/runtime.js";
import {
  Config_agGrid_API,
  Config_AutoRoll,
  Config_IsDark,
  Config_Menu_isFileMenu,
  Config_MenuVisible,
  Config_SelectedRow,
  Config_Status_Info,
  Config_SunnyNetIsStart,
  GetTextColor,
  getThisObject,
  registerThisObject,
  SetTextColor,
  setTheme
} from "./Config.js";
import {
  AppIsSetPort,
  GetError,
  GetPort,
  GOOS,
  McpFuncRes,
  ProtobufToJson,
  SetPort,
  Start
} from "../../brickly/api.js";
import {ElMessage} from "element-plus";
import {ExternalKeydownEventListener} from "./Keys";
import {PbJsonConvert} from "./encoding.js";

export default {
  props: ["addFilter", "setSelectedRow"],
  components: {},
  data() {
    return {
      previousPanels: new Set([]),
      lastTheology: 0,
      pendingDeltas: [],
    }
  },
  methods: {
    isWailsInsertRow(row) {
      return !!(row && (row.IsHTTP !== undefined || (row.URL != null && row["方式"] == null)));
    },
    applyCaptureDelta(delta) {
      const api = Config_agGrid_API.value;
      if (!api) {
        this.pendingDeltas.push(delta);
        return;
      }
      if (this.pendingDeltas.length > 0) {
        const queued = this.pendingDeltas.splice(0);
        for (const item of queued) this.applyCaptureDelta(item);
      }
      if (delta.type === "socket_stream") {
        return;
      }
      if (delta.type === "insert") {
        const rows = Array.isArray(delta.rows) ? delta.rows : [];
        if (rows.length === 0) {
          return;
        }
        if (this.isWailsInsertRow(rows[0])) {
          this.insertArray(rows, true);
          return;
        }
        try {
          const normalized = this.normalizeStreamRows(rows);
          const toAdd = [];
          const toUpdate = [];
          for (const row of normalized) {
            if (api.getRowNode(String(row.Theology))) toUpdate.push(row);
            else toAdd.push(row);
          }
          if (toUpdate.length > 0) {
            const upd = api.applyTransaction({ update: toUpdate });
            this.refreshCells(api, upd?.update);
          }
          let res = { add: [] };
          if (toAdd.length > 0) {
            res = api.applyTransaction({ add: toAdd });
          }
          const guarantee = normalized.find((r) => r.GuaranteeDisplay);
          if (guarantee && this.setSelectedRow && res?.add) {
            this.setSelectedRow(res.add, guarantee.Theology);
          }
          if (Config_AutoRoll.value && !Config_Menu_isFileMenu.value && res?.add?.length > 0) {
            const last = res.add[res.add.length - 1];
            this.ensureNodeVisible(api, last.data.Theology);
          }
          this.reloadSelectedIfTouched(normalized);
        } catch (e) {
          console.warn("[ListenOn] insert apply failed", e);
        }
        return;
      }
      if (delta.type === "update" && Array.isArray(delta.rows) && delta.rows.length > 0) {
        const rows = this.normalizeStreamRows(delta.rows);
        const res = api.applyTransaction({ update: rows });
        this.refreshCells(api, res?.update);
        this.reloadSelectedIfTouched(rows);
      } else if (delta.type === "delete") {
        const nodes = (delta.ids || [])
          .map((id) => api.getRowNode(String(id)))
          .filter(Boolean);
        if (nodes.length > 0) api.applyTransaction({ remove: nodes.map((n) => n.data) });
      } else if (delta.type === "clear") {
        api.setGridOption("rowData", []);
      }
    },
    openStream() {
      const pumpPending = () => {
        if (Config_agGrid_API.value && this.pendingDeltas.length > 0) {
          const queued = this.pendingDeltas.splice(0);
          for (const item of queued) this.applyCaptureDelta(item);
        } else if (!Config_agGrid_API.value) {
          requestAnimationFrame(pumpPending);
        }
      };
      pumpPending();
      openCaptureStream((delta) => this.applyCaptureDelta(delta))
        .catch((e) => console.warn("[ListenOn] capture-stream failed", e));
    },
    reloadSelectedIfTouched(rows) {
      const cur = Config_SelectedRow.value;
      const selected = parseInt(cur?.Theology ?? "0", 10);
      if (!selected || !Array.isArray(rows)) {
        return;
      }
      const row = rows.find((r) => parseInt(r?.Theology ?? "0", 10) === selected);
      if (!row) {
        return;
      }
      if (row.ico === cur.ico && row["状态"] === cur["状态"]) {
        return;
      }
      const api = Config_agGrid_API.value;
      const node = api?.getRowNode(String(selected));
      if (node?.data) {
        this.alertUpdate(node.data);
      }
    },
    normalizeStreamRows(rows) {
      return (rows || []).map((element) => {
        const Theology = String(element.Theology ?? "");
        this.addFilter(Theology, element.Filter);
        const row = { ...element, Theology };
        try { GetTextColor(row); } catch (_) {}
        return row;
      });
    },
    async startConfig() {
      try {
        Config_Status_Info.value = "正在启动中...";
        const port = await GetPort();
        await SetPort(port, true);
        await Start();
        const State = await AppIsSetPort()
        const o = getThisObject("SetIEProxyState")
        if (o) {
          o(State)
        }
        const error = await GetError();
        if (error === "") {
          Config_SunnyNetIsStart.value = true
          Config_Status_Info.value = `启动成功：端口号[${port}]`;
        } else {
          Config_SunnyNetIsStart.value = false
          Config_Status_Info.value = error;
        }
      } catch (err) {
        Config_Status_Info.value = `启动失败: ${err.message}`;
      }
    },
    runTask() {
      //注册监听Ag-Grid弹出层优先级
      requestAnimationFrame(() => {
        const currentPanels = document.getElementsByClassName("ag-panel");
        const newPanels = [];
        Array.from(currentPanels).forEach(panel => {
          if (!this.previousPanels.has(panel)) {
            newPanels.push(panel);
            this.previousPanels.add(panel)
            let mm = 5;
            this.previousPanels.forEach((obj) => {
              obj.style.zIndex = ++mm;
            })
          }
        });
        this.previousPanels.forEach((obj) => {
          if (!document.body.contains(obj)) {
            this.previousPanels.delete(obj)
            let mm = 5;
            this.previousPanels.forEach((obj) => {
              obj.style.zIndex = ++mm;
            })
          }
        })
        this.$nextTick(() => {
          const objs = document.getElementsByClassName("ag-virtual-list-viewport ag-rich-select-virtual-list-viewport ag-focus-managed ag-rich-select-list ag-ltr ag-popup-child ag-popup-positioned-under");
          if (objs.length > 0) {
            objs[0].parentElement.style.zIndex = '200'
          }
        })
        this.runTask();
      });
    },
    clickEvent(event) {
      //注册监听Ag-Grid弹出层优先级
      const target = event.target.closest(".ag-panel")
      if (target) {
        let mm = 5;
        this.previousPanels.delete(target)
        this.previousPanels.add(target)
        this.previousPanels.forEach((obj) => {
          obj.style.zIndex = ++mm;
        })
      }
    },
    alertUpdate(obj) {
      Config_SelectedRow.value = [];
      this.$nextTick(() => {
        Config_SelectedRow.value = obj;
      })
    },
    /** Wails 单参数事件：obj.data 即行数组；勿用 data[0] 取首行。 */
    normalizeHttpUpdateBatch(data) {
      if (data == null) {
        return [];
      }
      if (Array.isArray(data)) {
        if (data.length === 1 && Array.isArray(data[0])) {
          return data[0];
        }
        if (data.length > 0 && data[0] != null && data[0].Theology != null) {
          return data;
        }
        return data;
      }
      if (data.Theology != null) {
        return [data];
      }
      return [];
    },
    applyHttpSendRowUpdate(element, rowNode) {
      this.addFilter(element["Theology"] + "", element["Filter"]);
      const __url = element["URL"];
      if (!__url) {
        return rowNode.data;
      }
      try {
        const url = new URL(__url);
        rowNode.data["主机名"] = url.host;
        rowNode.data["路径"] = url.pathname;
        rowNode.data["参数"] = url.search ? url.search.substring(1) : "";
      } catch (_) {
        rowNode.data["主机名"] = "";
        rowNode.data["路径"] = "";
        rowNode.data["参数"] = "";
      }
      rowNode.data["请求地址"] = __url;
      // 拦截上行（BreakMode=1）不可改 Method
      if (element["Method"] && element["BreakMode"] !== 1) {
        rowNode.data["方式"] = element["Method"];
      }
      rowNode.data["ico"] = element["Ico"];
      rowNode.data["断点模式"] = element["BreakMode"];
      rowNode.data["注释"] = element["Note"];
      GetTextColor(rowNode.data);
      return rowNode.data;
    },
    applyHttpSendRowUpdates(array) {
      const api = Config_agGrid_API.value;
      if (!api) {
        return;
      }
      const newArray = [];
      const _SelectedTheology = parseInt(Config_SelectedRow.value?.Theology ?? "0");
      const pending = [];
      array.forEach((element) => {
        const th = element["Theology"] + "";
        const rowNode = api.getRowNode(th);
        if (rowNode) {
          const row = this.applyHttpSendRowUpdate(element, rowNode);
          newArray.push(row);
          if (parseInt(element["Theology"], 10) === _SelectedTheology) {
            this.alertUpdate(row);
          }
        } else {
          pending.push(element);
        }
      });
      if (newArray.length > 0) {
        const res = api.applyTransaction({update: newArray});
        this.refreshCells(api, res.update);
      }
      if (pending.length > 0) {
        const pendingRows = [];
        this.waitForRowRender(api, pending, (element, rowNode) => {
          const row = this.applyHttpSendRowUpdate(element, rowNode);
          pendingRows.push(row);
          if (parseInt(element["Theology"], 10) === _SelectedTheology) {
            this.alertUpdate(row);
          }
          return row;
        }, [], () => {
          if (pendingRows.length > 0) {
            const res = api.applyTransaction({update: pendingRows});
            this.refreshCells(api, res.update);
          }
        });
      }
    },
    /**
     *  等待 ag-grid 渲染完成后 更新数据
     * @param api ag-grid 的API
     * @param obj 后端返回的数组对象
     * @param callback 数组中的每个行对象处理函数
     * @param resArray 处理后返回的数组
     * @param complete 数组中的所有行对象处理完成后调用的函数
     */
    waitForRowRender(api, obj, callback, resArray, complete) {
      //先过滤掉已经处理过的行对象，和2秒内在ag-grid中没有找到的 行对象
      const array = obj.filter((element) => {
        if (element["updateTime"] === -1) {
          return false;
        }
        if (!element["updateTime"]) {
          element["updateTime"] = Date.now();
        }
        return (Date.now() - element["updateTime"]) < 5000;
      });
      if (array.length < 1) {
        complete()
        return
      }
      requestAnimationFrame(() => {
        array.forEach((element) => {
          const rowNode = api.getRowNode(element["Theology"] + "");
          if (rowNode) {
            element["updateTime"] = -1;
            resArray.push(callback(element, rowNode));
          }
        })
        this.waitForRowRender(api, array, callback, resArray, complete);
      });
    },
    ensureNodeSelected(api, Theology) {
      const node = api.getRowNode(Theology + "");
      if (node) {
        api.ensureNodeVisible(node);
        return
      }
      this.ensureNodeVisible(api, Theology)
    },
    ensureNodeVisible(api, Theology) {
      requestAnimationFrame(() => {
        if (Config_AutoRoll.value) {
          if (Config_MenuVisible.value === false) {
            this.ensureNodeSelected(api, Theology)
          } else if (Config_MenuVisible.value && Config_Menu_isFileMenu.value) {
            this.ensureNodeSelected(api, Theology)
          }
        }
      })
    },
    refreshCells(api, rowNodes) {
      api.refreshCells({
        columns: ['序号'],
        force: true
      });
    },
    insertArray(array, isDone, Func) {
      if (Array.isArray(array) && array.length > 0) {
        const api = Config_agGrid_API.value;
        if (!api) {
          this.pendingDeltas.push({ type: "insert", rows: array });
          if (Func) Func([]);
          return;
        }
        const newArray = [];
        const updateArray = [];
        let GuaranteeDisplay = "";
        array.forEach((element) => {
          const Theology = element["Theology"] + "";
          const rowNode = api.getRowNode(Theology);
          if (rowNode) {
            if (element["IsHTTP"]) {
              const row = this.applyHttpSendRowUpdate(element, rowNode);
              if (element["State"]) {
                row["状态"] = element["State"];
              }
              updateArray.push(row);
            }
            return;
          }
          this.addFilter(element["Theology"] + "", element["Filter"]);
          if (element["IsHTTP"]) {
            const __url = element["URL"];
            let host = "", path = "", params = "";
            try {
              const url = new URL(__url);
              host = url.host;
              path = url.pathname;
              params = url.search ? url.search.substring(1) : "";
            } catch (_) {
              host = "";
              path = "";
              params = "";
            }
            if (element["GuaranteeDisplay"]) {
              GuaranteeDisplay = Theology
            }
            newArray.push({
              "方式": element["Method"],
              "请求地址": __url,
              "主机名": host,
              "路径": path,
              "状态": element["State"] || "  -  ",
              "注释": element["Note"],
              "身份验证账号": element["UserName"],
              "参数": params,
              "进程": element["ProcessName"],
              "来源地址": element["ClientIP"],
              "请求时间": element["Time"],
              "ico": element["Ico"],
              "断点模式": element["BreakMode"],
              "Theology": Theology,
            })
            return
          }
          newArray.push({
            "方式": element["Method"],
            "请求地址": element["ClientIP"] + " -> " + element["Host"],
            "响应IP": element["RemoteAddress"],
            "主机名": element["Host"],
            "身份验证账号": element["UserName"],
            "路径": "",
            "状态": "已连接",
            "响应长度": "0/0",
            "参数": "",
            "注释": element["Note"],
            "进程": element["ProcessName"],
            "来源地址": element["ClientIP"],
            "请求时间": element["Time"],
            "ico": element["Ico"],
            "Theology": Theology,
          })
        })
        newArray.forEach((element) => {
          GetTextColor(element)
        })
        if (updateArray.length > 0) {
          const upd = api.applyTransaction({ update: updateArray });
          this.refreshCells(api, upd?.update);
          this.reloadSelectedIfTouched(updateArray);
        }
        if (newArray.length === 0) {
          if (Func) Func([]);
          return;
        }
        const res = api.applyTransaction({
          add: newArray,
        });
        if (res?.add?.length > 0) {
          //api.applyColumnState({state: [{colId: 'Theology', sort: 'asc'}], defaultState: {sort: null},});
          const resNodes = [];
          this.waitForRowRender(api, newArray, () => {
          }, resNodes, () => {
            if (GuaranteeDisplay !== "") {
              this.setSelectedRow(res.add, GuaranteeDisplay)
            }
            if (isDone && (Config_AutoRoll.value && !Config_Menu_isFileMenu.value)) {
              const node = res.add[res.add.length - 1];
              this.ensureNodeVisible(api, node.data.Theology);
            }
            this.refreshCells(api, res.add)
            if (Func) {
              Func(res.add)
            }
          })
          return
        }
      }
      if (Func) {
        Func([])
      }
    }
  },
  mounted() {
    this.openStream()
    registerThisObject("MCPApplyHttpSendRowUpdate", (body) => {
      if (body && body.theology != null) {
        this.applyHttpSendRowUpdates([{
          Theology: body.theology,
          URL: body.url,
          Method: body.method,
          Ico: body.ico,
          Note: body.note,
          BreakMode: body.breakMode,
          Filter: body.filter,
        }]);
      }
    });
    //注册监听Ag-Grid弹出层优先级
    {
      this.runTask()
      document.body.addEventListener("mousedown", this.clickEvent)
    }
    {
      Events.On("setTheme", (obj) => {
        setTheme(obj.data[0], obj.data[1])
      })
      Events.On("SetIsDark", (obj) => {
        const dark = obj.data[0] === true || obj.data === true;
        if (Config_IsDark.value === dark) {
          return
        }
        Config_IsDark.value = dark
        try {
          document.documentElement.className = dark ? "dark" : "light";
        } catch (e) {

        }
      })
    }
    {
      Events.On("ListColor", (obj) => {
        const ColorID = obj.data[0]
        const Color = obj.data[1]
        SetTextColor(ColorID, Color)
      })
      GOOS().then(() => {
        Events.On("ExternalKeydownEventListener", (obj) => {
          let o = obj.data[0];
          if (!o) {
            o = obj.data;
          }
          ExternalKeydownEventListener(o)
        })
      })
      Events.On("onError", (obj) => {
        let o = obj.data[0];
        if (!o) {
          o = obj.data;
        }
        ElMessage.error(o)
      })
      Events.On("mcp", async (evt) => {
        const mcp = evt?.data ?? {};
        const reply = (text) => {
          mcp.res = text;
          typeof McpFuncRes === "function" && McpFuncRes(mcp);
        };
        try {
          const page = String(mcp.page ?? "").toLowerCase();
          const tag = String(mcp.tag ?? "").toLowerCase();
          if (page !== "main") return;
          const msg = String(mcp.msg ?? "");
          switch (tag) {
            case "getcapturealllist":
              const array = {}
              const api = Config_agGrid_API.value;
              let rowNo = 0;
              api.forEachNodeAfterFilterAndSort((node) => {
                rowNo++;
                const theology = parseInt(node.data["Theology"]);
                let method = (node.data["方式"] + "").toUpperCase();
                if (method.includes("TCP")) {
                  if (method.includes("TLS")) {
                    method = "TLS-TCP"
                  } else {
                    method = "TCP"
                  }
                } else if (method.includes("UDP")) {
                  method = "UDP"
                } else if (method.includes("Websocket".toUpperCase()) || method.includes("WS")) {
                  method = "WS"
                } else {
                  method = "HTTP"
                }
                if (!array[method]) {
                  array[method] = []
                }
                array[method].push({
                  theology: theology,
                  id: rowNo
                })
              });
              return reply(JSON.stringify(array)); 
            case "pbconvert":
              let rs = {};
              ProtobufToJson(msg, 0).then(response => {
                try {
                  if (response === 'null' || response === '') {
                    rs = {"Data": "无效的 Protobuf 数据"}
                    return
                  }
                  rs = PbJsonConvert(JSON.parse(response))
                } catch (e) {
                  rs = {"Data": " Protobuf 数据", "Error": e}
                }
              })
              return reply(JSON.stringify(rs));
            default:
              return;
          }
        } catch (e) {
          // 异常兜底：避免对端一直等
          try {
            reply("处理失败");
          } catch (_) {
          }
        }
      });
    }
    this.startConfig()
  }
}
</script>

<template>
  <div style="height: 0px;width: 0px;display: none">
  </div>
</template>
