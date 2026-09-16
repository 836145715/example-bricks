<script setup>
import { ref, onMounted } from 'vue'
import {Events} from "../brickly/runtime.js";

const name = ref('')
const result = ref('Please enter your name below 👇')
const time = ref('Listening for Time event...')

const doGreet = () => {
  result.value = name.value ? `Hello ${name.value}` : 'Please enter your name below 👇'
}

onMounted(() => {
  Events.On('time', (timeValue) => {
    time.value = timeValue.data;
  });
})

defineProps({
  msg: String,
})
</script>

<template>
  <h1>{{ msg }}</h1>
  <div aria-label="result" class="result">{{ result }}</div>
  <div class="card">
    <div class="input-box">
      <input aria-label="input" class="input" v-model="name" type="text" autocomplete="off"/>
      <button class="btn" @click="doGreet">Greet</button>
    </div>
    <p>{{ time }}</p>
  </div>
</template>
