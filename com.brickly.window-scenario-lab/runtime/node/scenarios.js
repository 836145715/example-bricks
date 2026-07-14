'use strict'

/** 场景预设：id → 展示名 + createBrowserWindow options */

const SCENARIOS = {
  standard: {
    label: '标准窗',
    options: {
      width: 520,
      height: 420,
      title: 'Scenario · standard',
      backgroundColor: '#0f172a',
      show: true,
      resizable: true,
      minimizable: true,
      maximizable: true
    }
  },
  compact: {
    label: '紧凑窗',
    options: {
      width: 360,
      height: 280,
      title: 'Scenario · compact',
      backgroundColor: '#111827',
      show: true,
      resizable: true
    }
  },
  frameless: {
    label: '无边框',
    options: {
      width: 480,
      height: 360,
      title: 'Scenario · frameless',
      backgroundColor: '#1e293b',
      show: true,
      frame: false,
      resizable: true,
      transparent: false
    }
  },
  'always-on-top': {
    label: '置顶',
    options: {
      width: 420,
      height: 320,
      title: 'Scenario · always-on-top',
      backgroundColor: '#0f172a',
      show: true,
      alwaysOnTop: true,
      resizable: true
    }
  },
  'skip-taskbar': {
    label: '跳过任务栏',
    options: {
      width: 420,
      height: 320,
      title: 'Scenario · skip-taskbar',
      backgroundColor: '#0f172a',
      show: true,
      skipTaskbar: true,
      resizable: true
    }
  },
  fixed: {
    label: '固定尺寸',
    options: {
      width: 500,
      height: 380,
      title: 'Scenario · fixed',
      backgroundColor: '#0f172a',
      show: true,
      resizable: false,
      maximizable: false,
      minimizable: true
    }
  },
  transparent: {
    label: '透明底',
    options: {
      width: 440,
      height: 340,
      title: 'Scenario · transparent',
      backgroundColor: '#00000000',
      show: true,
      frame: false,
      transparent: true,
      resizable: true,
      hasShadow: true
    }
  },
  wide: {
    label: '宽屏条',
    options: {
      width: 960,
      height: 280,
      title: 'Scenario · wide',
      backgroundColor: '#0b1220',
      show: true,
      resizable: true
    }
  },
  tall: {
    label: '竖长条',
    options: {
      width: 360,
      height: 720,
      title: 'Scenario · tall',
      backgroundColor: '#0b1220',
      show: true,
      resizable: true
    }
  },
  offset: {
    label: '偏移位置',
    options: {
      width: 480,
      height: 360,
      x: 80,
      y: 80,
      title: 'Scenario · offset',
      backgroundColor: '#0f172a',
      show: true,
      resizable: true
    }
  }
}

const DEFAULT_SUITE = [
  'standard',
  'compact',
  'frameless',
  'always-on-top',
  'fixed',
  'wide',
  'offset'
]

function listScenarioMeta() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label }))
}

module.exports = {
  SCENARIOS,
  DEFAULT_SUITE,
  listScenarioMeta
}
