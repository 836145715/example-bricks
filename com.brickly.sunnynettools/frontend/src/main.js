import {createApp} from 'vue'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import ContextMenu from "@imengyu/vue3-context-menu"
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'
import {AllEnterpriseModule, IntegratedChartsModule, LicenseManager} from "ag-grid-enterprise";
import {AgChartsEnterpriseModule} from "ag-charts-enterprise";

import TitlebarComponent from "./components/TitleBar/VUETitlebar/vueTitlebar.vue"
import {
    AllCommunityModule,
    ModuleRegistry,
    themeAlpine,
    themeBalham,
    themeMaterial,
    themeQuartz,
} from "ag-grid-community";

import { setLocaleData } from 'monaco-editor-nls';
import zh_CN from 'monaco-editor-nls/locale/zh-hans';

// Brickly：UI 一加载就 start，拿到全局唯一 handle 后再挂载应用
import { ensureRuntime } from "./wails-shim/index.js";

setLocaleData(zh_CN);
import {LicenseKey} from "./AGLicenseKey";
/*
{
    console.log = (...args) => {
    };
    console.error = (...args) => {
    };
    console.warn = (...args) => {
    };
    window.onerror = (message, source, lineno, colno, error) => {
        return true; // 阻止错误向上冒泡
    };

}
*/
window.themes = [
    {id: "themeQuartz", theme: themeQuartz},
    {id: "themeBalham", theme: themeBalham},
    {id: "themeMaterial", theme: themeMaterial},
    {id: "themeAlpine", theme: themeAlpine},
];

ModuleRegistry.registerModules([AllCommunityModule, IntegratedChartsModule.with(AgChartsEnterpriseModule), AllEnterpriseModule]);

LicenseManager.setLicenseKey(LicenseKey);
 

import './monaco-setup.js';
document.addEventListener("mousemove", function (event) {
    window.mouseX = event.clientX;
    window.mouseY = event.clientY;
});

const app = createApp(App)
app.component(TitlebarComponent.name, TitlebarComponent);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
}
app.use(ContextMenu)
app.use(ElementPlus, {locale: zhCn});

// 启动遮罩：start 成功后才挂载 Vue 应用；失败则显示错误不进入 UI
;(function bootstrap() {
    const mask = document.createElement('div');
    mask.id = 'brickly-boot-mask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;background:#141414;color:#cfd3dc;font-family:sans-serif;font-size:14px;';
    const title = document.createElement('div');
    title.textContent = '正在启动 SunnyNetTools 运行时…';
    const bar = document.createElement('div');
    bar.style.cssText = 'width:220px;height:4px;border-radius:2px;background:#2c2c2c;overflow:hidden;';
    const inner = document.createElement('div');
    inner.style.cssText = 'width:40%;height:100%;background:#409eff;border-radius:2px;animation:brickly-boot 1.2s ease-in-out infinite;';
    inner.style.transformOrigin = 'left';
    const style = document.createElement('style');
    style.textContent = '@keyframes brickly-boot{0%{transform:translateX(-100%)}100%{transform:translateX(280%)}}';
    bar.appendChild(inner);
    mask.appendChild(title);
    mask.appendChild(bar);
    document.body?.appendChild(mask);
    document.head?.appendChild(style);

    ensureRuntime()
        .then(() => {
            title.textContent = '启动成功';
            app.mount('#app');
            setTimeout(() => mask.remove(), 200);
        })
        .catch((err) => {
            console.error('[brickly] runtime start failed', err);
            title.textContent = '运行时启动失败：' + (err?.message || err);
            bar.style.display = 'none';
        });
})();
