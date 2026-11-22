import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

let instance = 0
async function harness(run) {
  const previousWindow = globalThis.window
  const instances = []
  const timers = new Map()
  const transcripts = []
  let timerId = 0
  class Recognition {
    stopped = false
    aborted = false
    constructor() { instances.push(this) }
    start() {}
    stop() { this.stopped = true }
    abort() { this.aborted = true }
    result(...texts) { this.onresult?.({ results: texts.map((transcript) => [{ transcript }]) }) }
    end() { this.onend?.() }
    error(error) { this.onerror?.({ error }) }
  }
  globalThis.window = {
    SpeechRecognition: Recognition, isSecureContext: true,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId },
    clearTimeout: (id) => timers.delete(id),
  }
  const slots = []
  let cursor = 0
  let effects = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) {
      const slot = slots[cursor++] ??= { value: initial }
      return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useCallback(callback, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback }
      return slots[index].callback
    },
    useEffect(callback, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.()
        slots[index] = { deps, cleanup: callback() }
      })
    },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot() },
  }
  const key = `__dictation${instance++}`
  globalThis[key] = hooks
  const source = (await readFile(new URL('../src/hooks/useTutorDictation.ts', import.meta.url), 'utf8'))
    .replace(/import \{ ([^}]+) \} from 'react'/, `const { $1 } = globalThis[${JSON.stringify(key)}]`)
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  const { useTutorDictation } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  delete globalThis[key]
  const onTranscript = (text) => transcripts.push(text)
  function render(active = true) {
    cursor = 0; effects = []
    const result = useTutorDictation(active, onTranscript)
    for (const effect of effects) effect()
    return result
  }
  function unmount() { for (const slot of slots) slot?.cleanup?.() }
  function restart() {
    const callbacks = [...timers.values()]
    timers.clear()
    for (const callback of callbacks) callback()
  }
  try { await run({ render, instances, transcripts, timers, restart, unmount }) }
  finally { unmount(); globalThis.window = previousWindow }
}

test('dictation stays selected across pauses and appends a restarted session without duplicating interim text', () => harness(({ render, instances, transcripts, restart }) => {
  render().start('My answer:')
  assert.equal(instances[0].continuous, true)
  instances[0].result('the sign')
  instances[0].result('the sign changes')
  assert.equal(transcripts.at(-1), 'My answer: the sign changes')
  instances[0].end()
  assert.equal(render().listening, true)
  restart()
  assert.equal(instances.length, 2)
  instances[1].result('at a zero')
  instances[1].result('at a zero', 'or an undefined point')
  assert.equal(transcripts.at(-1), 'My answer: the sign changes at a zero or an undefined point')
}))

test('pressing stop allows a final transcript and prevents the browser from restarting', () => harness(({ render, instances, transcripts, timers, restart }) => {
  render().start('')
  instances[0].result('negative divided')
  render().stop()
  assert.equal(instances[0].stopped, true)
  instances[0].result('negative divided by negative is positive')
  instances[0].end()
  restart()
  assert.equal(render().listening, false)
  assert.equal(transcripts.at(-1), 'negative divided by negative is positive')
  assert.equal(timers.size, 0)
  assert.equal(instances.length, 1)
}))

test('stopping during a pause cancels the scheduled restart', () => harness(({ render, instances, restart, timers }) => {
  render().start('')
  instances[0].end()
  assert.equal(timers.size, 1)
  render().stop()
  restart()
  assert.equal(render().listening, false)
  assert.equal(instances.length, 1)
}))

test('silence keeps the microphone selected while permission errors end recording', () => harness(({ render, instances, restart, timers }) => {
  render().start('')
  instances[0].error('no-speech')
  instances[0].end()
  assert.equal(render().error, '')
  assert.equal(render().listening, true)
  restart()
  instances[1].error('not-allowed')
  restart()
  assert.equal(render().listening, false)
  assert.match(render().error, /permission was denied/)
  assert.equal(timers.size, 0)
  assert.equal(instances.length, 2)
}))

test('closing the chat cancels recording and ignores late browser results', () => harness(({ render, instances, transcripts, timers }) => {
  render().start('')
  const lateResult = instances[0].onresult
  render(false)
  assert.equal(instances[0].aborted, true)
  lateResult({ results: [[{ transcript: 'late text' }]] })
  assert.deepEqual(transcripts, [])
  assert.equal(render(false).listening, false)
  assert.equal(timers.size, 0)
}))

test('reaching the message limit stops dictation without an automatic restart', () => harness(({ render, instances, transcripts, restart }) => {
  render().start('x'.repeat(2995))
  instances[0].result('more words than fit')
  assert.equal(transcripts.at(-1).length, 3000)
  assert.equal(instances[0].stopped, true)
  instances[0].end()
  restart()
  assert.equal(render().listening, false)
  assert.equal(instances.length, 1)
}))
