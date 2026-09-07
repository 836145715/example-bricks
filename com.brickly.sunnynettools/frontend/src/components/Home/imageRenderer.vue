<script>
import {GetImage} from "../Tools/image.JS";

export default {
  data() {
    return {
      imageBase64: "",
      value: ""
    }
  },
  beforeMount() {
    this.sync(this.params)
  },
  methods: {
    sync(params) {
      if (!params) {
        return
      }
      this.value = params.value
      const data = params.data || {}
      const mode = data["断点模式"]
      if (mode === 1) {
        this.imageBase64 = GetImage("拦截上行")
      } else if (mode === 2) {
        this.imageBase64 = GetImage("拦截下行")
      } else {
        this.imageBase64 = GetImage(data["ico"])
      }
    },
    refresh(params) {
      this.sync(params)
      return true
    }
  }
};
</script>
<template>
  <div style="cursor: pointer; display: flex; align-items: center;">
    <img :src="imageBase64" style="height: 22px;width: 22px"/>&nbsp;{{ value }}
  </div>
</template>
