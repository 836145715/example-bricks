import { ref } from "vue";

export const Config_ToolModal = ref({
    name: "",
    open: false,
    args: ""
});

export function OpenTools(name, open, args) {
    const n = String(name || "");
    const isOpen = !(open === false || open === 0 || open === "false");
    if (!isOpen) {
        const cur = Config_ToolModal.value;
        if (!n || cur.name === n) {
            Config_ToolModal.value = { name: cur.name, open: false, args: cur.args || "" };
        }
        return Promise.resolve();
    }
    Config_ToolModal.value = { name: n, open: true, args: args ?? "" };
    return Promise.resolve();
}
