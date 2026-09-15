/* eslint-disable */
;(function () {
  'use strict'

  const scene = document.getElementById('scene')
  const backdrop = document.getElementById('backdrop')
  const canvas = document.getElementById('fx')
  const crosshair = document.getElementById('crosshair')
  const marker = document.getElementById('marker')
  const flash = document.getElementById('flash')
  const fx2d = canvas.getContext('2d')

  // aim → locked → inbound → boom → aftermath → done
  let state = 'boot'
  let options = { lockDelayMs: 800, mute: false }
  let target = null
  let lastMouse = null
  let rafId = 0
  const particles = []
  let missile = null
  let boomAt = 0

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(window.innerWidth * dpr)
    canvas.height = Math.round(window.innerHeight * dpr)
    fx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  window.addEventListener('resize', resize)
  resize()

  // ---------- 与 runtime 的桥 ----------

  function request(name, payload, opts) {
    try {
      if (window.brickly && typeof window.brickly.request === 'function') {
        return window.brickly.request(name, payload, opts)
      }
    } catch {}
    return Promise.resolve(undefined)
  }

  // 页面加载早于 runtime 的 win.expose 注册也没关系：宿主会把请求排队到窗口
  // running，runtime 尚未 expose 时还会用同一 requestId 重试——一次请求即可。
  // catch 只兜底浏览器直接打开（preview）或宿主异常的情况。
  async function requestInit() {
    try {
      const init = await request('strike:init', undefined, { timeoutMs: 8000 })
      return init && typeof init === 'object' ? init : null
    } catch {
      return null
    }
  }

  async function boot() {
    const init = await requestInit()
    if (init && typeof init === 'object') {
      if (typeof init.backdrop === 'string' && init.backdrop) {
        backdrop.src = init.backdrop
      } else {
        backdrop.classList.add('empty')
      }
      if (init.options) {
        options = { ...options, ...init.options }
      }
    } else {
      backdrop.classList.add('empty')
    }
    state = 'aim'
    if (lastMouse) {
      crosshair.style.transform = `translate(${lastMouse.x}px, ${lastMouse.y}px)`
    }
    crosshair.classList.remove('hidden')
  }

  function finish() {
    state = 'done'
    scene.classList.add('fading')
    void request('strike:done', { target })
  }

  function cancel() {
    if (state === 'done') return
    state = 'done'
    void request('strike:cancel')
  }

  // ---------- 音效（全合成，无外部资源） ----------

  let ac = null
  function audio() {
    if (options.mute) return null
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)()
      if (ac.state === 'suspended') void ac.resume()
      return ac
    } catch {
      return null
    }
  }

  function beep(delay) {
    const ctx = audio()
    if (!ctx) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 940
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.1)
  }

  function whistle(durSec) {
    const ctx = audio()
    if (!ctx) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1500, t)
    osc.frequency.exponentialRampToValueAtTime(220, t + durSec)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durSec)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + durSec)
  }

  function boom() {
    const ctx = audio()
    if (!ctx) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.9)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.setValueAtTime(900, t)
    lowpass.frequency.exponentialRampToValueAtTime(90, t + 0.7)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.5, t)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
    noise.connect(lowpass).connect(noiseGain).connect(ctx.destination)
    noise.start(t)

    const sub = ctx.createOscillator()
    const subGain = ctx.createGain()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(70, t)
    sub.frequency.exponentialRampToValueAtTime(32, t + 0.55)
    subGain.gain.setValueAtTime(0.4, t)
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    sub.connect(subGain).connect(ctx.destination)
    sub.start(t)
    sub.stop(t + 0.65)
  }

  // ---------- 交互 ----------

  window.addEventListener('mousemove', (e) => {
    lastMouse = { x: e.clientX, y: e.clientY }
    if (state !== 'aim') return
    crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
  })

  window.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      cancel()
      return
    }
    if (state !== 'aim' || e.button !== 0) return
    lock(e.clientX, e.clientY)
  })

  window.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel()
  })

  function lock(x, y) {
    state = 'locked'
    target = { x: Math.round(x), y: Math.round(y) }
    scene.classList.add('locked')
    crosshair.classList.add('hidden')
    marker.style.transform = `translate(${target.x}px, ${target.y}px)`
    marker.classList.remove('hidden')
    audio()
    for (let i = 0; i < 3; i++) beep((options.lockDelayMs / 1000) * (i / 3))
    setTimeout(launch, options.lockDelayMs)
  }

  // ---------- 导弹 + 爆炸 ----------

  function launch() {
    if (state !== 'locked') return
    state = 'inbound'
    missile = {
      x: target.x + (Math.random() * 80 - 40),
      y: -140,
      t0: performance.now(),
      durMs: 540
    }
    whistle(missile.durMs / 1000 + 0.15)
    tick()
  }

  function tick() {
    rafId = requestAnimationFrame(tick)
    const now = performance.now()
    fx2d.clearRect(0, 0, window.innerWidth, window.innerHeight)

    if (missile) {
      const p = Math.min(1, (now - missile.t0) / missile.durMs)
      const ease = p * p * p
      const mx = missile.x + (target.x - missile.x) * ease
      const my = missile.y + (target.y - missile.y) * ease
      spawnTrail(mx, my)
      drawMissile(mx, my)
      if (p >= 1) {
        missile = null
        impact(now)
      }
    }

    drawParticles()
    drawExplosion(now)
  }

  function drawMissile(x, y) {
    fx2d.save()
    fx2d.translate(x, y)
    fx2d.rotate(0.08)
    const flame = 12 + Math.random() * 10
    const grad = fx2d.createLinearGradient(0, -34 - flame, 0, 0)
    grad.addColorStop(0, 'rgba(255,120,40,0)')
    grad.addColorStop(1, 'rgba(255,200,90,0.9)')
    fx2d.fillStyle = grad
    fx2d.beginPath()
    fx2d.moveTo(0, -30 - flame)
    fx2d.lineTo(4, -22)
    fx2d.lineTo(-4, -22)
    fx2d.closePath()
    fx2d.fill()
    fx2d.fillStyle = '#3d4451'
    fx2d.fillRect(-5, -24, 10, 24)
    fx2d.fillStyle = '#ff2d2d'
    fx2d.beginPath()
    fx2d.moveTo(-5, -24)
    fx2d.lineTo(5, -24)
    fx2d.lineTo(0, -34)
    fx2d.closePath()
    fx2d.fill()
    fx2d.fillStyle = '#2a2f3a'
    fx2d.fillRect(-9, -8, 4, 8)
    fx2d.fillRect(5, -8, 4, 8)
    fx2d.restore()
  }

  function spawnTrail(x, y) {
    particles.push({
      kind: 'smoke',
      x: x + (Math.random() * 8 - 4),
      y: y - 26,
      vx: Math.random() * 0.6 - 0.3,
      vy: -0.5 - Math.random() * 0.5,
      size: 4 + Math.random() * 5,
      life: 0,
      maxLife: 55 + Math.random() * 25
    })
  }

  function impact(now) {
    state = 'boom'
    boomAt = now
    scene.classList.add('shaking', 'boom')
    flash.classList.remove('on')
    void flash.offsetWidth
    flash.classList.add('on')
    marker.classList.add('hidden')
    boom()

    for (let i = 0; i < 46; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 7
      particles.push({
        kind: 'spark',
        x: target.x,
        y: target.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        size: 1.5 + Math.random() * 2.5,
        life: 0,
        maxLife: 40 + Math.random() * 45
      })
    }
    for (let i = 0; i < 14; i++) {
      particles.push({
        kind: 'smoke',
        x: target.x + (Math.random() * 40 - 20),
        y: target.y - Math.random() * 20,
        vx: Math.random() * 1.2 - 0.6,
        vy: -0.6 - Math.random() * 1.1,
        size: 9 + Math.random() * 14,
        life: 0,
        maxLife: 90 + Math.random() * 60
      })
    }

    setTimeout(() => {
      const scorch = document.createElement('div')
      scorch.id = 'scorch'
      scorch.style.left = `${target.x}px`
      scorch.style.top = `${target.y}px`
      scene.appendChild(scorch)
    }, 380)
    setTimeout(finish, 1500)
  }

  function drawExplosion(now) {
    if (state !== 'boom') return
    const t = (now - boomAt) / 1000
    if (t < 0.75) {
      const p = t / 0.75
      const r = 30 + p * 150
      const g = fx2d.createRadialGradient(target.x, target.y, 0, target.x, target.y, r)
      g.addColorStop(0, `rgba(255,255,240,${0.95 - p * 0.55})`)
      g.addColorStop(0.35, `rgba(255,177,61,${0.9 - p * 0.5})`)
      g.addColorStop(0.7, `rgba(229,72,77,${0.65 - p * 0.55})`)
      g.addColorStop(1, 'rgba(60,20,10,0)')
      fx2d.fillStyle = g
      fx2d.beginPath()
      fx2d.arc(target.x, target.y, r, 0, Math.PI * 2)
      fx2d.fill()
    }
    if (t < 0.6) {
      const p = t / 0.6
      fx2d.strokeStyle = `rgba(255,230,180,${0.75 - p * 0.75})`
      fx2d.lineWidth = 10 - p * 8
      fx2d.beginPath()
      fx2d.arc(target.x, target.y, 24 + p * 330, 0, Math.PI * 2)
      fx2d.stroke()
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.life++
      if (p.life >= p.maxLife) {
        particles.splice(i, 1)
        continue
      }
      p.x += p.vx
      p.y += p.vy
      const k = 1 - p.life / p.maxLife
      if (p.kind === 'spark') {
        p.vy += 0.16
        fx2d.fillStyle = `rgba(255,${140 + Math.floor(80 * k)},40,${k})`
        fx2d.beginPath()
        fx2d.arc(p.x, p.y, p.size * k, 0, Math.PI * 2)
        fx2d.fill()
      } else {
        p.size += 0.12
        fx2d.fillStyle = `rgba(70,66,60,${0.35 * k})`
        fx2d.beginPath()
        fx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        fx2d.fill()
      }
    }
  }

  void boot()
})()
