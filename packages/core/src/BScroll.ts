import { BScrollInstance, propertiesConfig } from './Instance'
import { Options, DefOptions, OptionsConstructor } from './Options'
import Scroller from './scroller/Scroller'
import {
  getElement,
  warn,
  isUndef,
  propertiesProxy,
  ApplyOrder,
  EventEmitter,
} from '@better-scroll/shared-utils'
import { bubbling } from './utils/bubbling'
import { UnionToIntersection } from './utils/typesHelper'

interface PluginCtor {
  pluginName: string
  applyOrder?: ApplyOrder
  new (scroll: BScroll): any
}

interface PluginItem {
  name: string
  applyOrder?: ApplyOrder.Pre | ApplyOrder.Post
  ctor: PluginCtor
}
interface PluginsMap {
  [key: string]: boolean
}
interface PropertyConfig {
  key: string
  sourceKey: string
}

type ElementParam = HTMLElement | string

export interface MountedBScrollHTMLElement extends HTMLElement {
  isBScrollContainer?: boolean
}

export class BScrollConstructor<O = {}> extends EventEmitter {
  static plugins: PluginItem[] = []
  static pluginsMap: PluginsMap = {}
  scroller: Scroller
  options: OptionsConstructor
  hooks: EventEmitter
  plugins: { [name: string]: any }
  wrapper: HTMLElement
  content: HTMLElement;
  [key: string]: any

  static use(ctor: PluginCtor) {
    const name = ctor.pluginName
    const installed = BScrollConstructor.plugins.some(
      (plugin) => ctor === plugin.ctor
    )
    if (installed) return BScrollConstructor
    if (isUndef(name)) {
      warn(
        `Plugin Class must specify plugin's name in static property by 'pluginName' field.`
      )
      return BScrollConstructor
    }
    BScrollConstructor.pluginsMap[name] = true
    BScrollConstructor.plugins.push({
      name,
      applyOrder: ctor.applyOrder,
      ctor,
    })
    return BScrollConstructor
  }

  constructor(el: ElementParam, options?: Options & O) {
    super([
      'refresh',
      'contentChanged',
      'enable',
      'disable',
      'beforeScrollStart',
      'scrollStart',
      'scroll',
      'scrollEnd',
      'scrollCancel',
      'touchEnd',
      'flick',
      'destroy',
    ])

    // 获取wrapper
    const wrapper = getElement(el)

    if (!wrapper) {
      warn('Can not resolve the wrapper DOM.')
      return
    }

    this.plugins = {}
    // 合并options https://better-scroll.github.io/docs/zh-CN/guide/base-scroll-options.html
    this.options = new OptionsConstructor().merge(options).process()

    // 判断是否能正确获取content，并设置this.content
    if (!this.setContent(wrapper).valid) {
      return
    }

    // 注册事件
    this.hooks = new EventEmitter([
      'refresh',
      'enable',
      'disable',
      'destroy',
      'beforeInitialScrollTo',
      'contentChanged',
    ])

    // 初始化
    this.init(wrapper)
  }

  setContent(wrapper: MountedBScrollHTMLElement) {
    let contentChanged = false
    let valid = true
    const content = wrapper.children[
      this.options.specifiedIndexAsContent
    ] as HTMLElement
    if (!content) {
      warn(
        'The wrapper need at least one child element to be content element to scroll.'
      )
      valid = false
    } else {
      contentChanged = this.content !== content
      if (contentChanged) {
        this.content = content
      }
    }
    return {
      valid,
      contentChanged,
    }
  }

  private init(wrapper: MountedBScrollHTMLElement) {
    this.wrapper = wrapper

    // mark wrapper to recognize bs instance by DOM attribute
    // 设置wrapper(dom)的isBScrollContainer为true
    wrapper.isBScrollContainer = true
    // 初始化scroller，核心scroller
    this.scroller = new Scroller(wrapper, this.content, this.options)
    // 监听scroller.hooks的resize事件，也就是window.resize事件
    this.scroller.hooks.on(this.scroller.hooks.eventTypes.resize, () => {
      this.refresh()
    })

    // 事件冒泡
    this.eventBubbling()

    // 在滚动之前会让当前激活的元素（input、textarea）自动失去焦点。
    this.handleAutoBlur()
    // 设置enalbe
    this.enable()

    // 属性代理见this.xxx属性代理的this.scroller.xxx.xxx属性上
    this.proxy(propertiesConfig)
    // 应用插件
    this.applyPlugins()

    // maybe boundary has changed, should refresh
    // 刷新better-scroll
    this.refreshWithoutReset(this.content)
    const { startX, startY } = this.options
    const position = {
      x: startX,
      y: startY,
    }
    // maybe plugins want to control scroll position
    // 出发hooksbeforeInitialScrollTo的beforeInitialScrollTo事件,供插件监听
    if (
      this.hooks.trigger(this.hooks.eventTypes.beforeInitialScrollTo, position)
    ) {
      return
    }
    // 滚动到初始化的位置
    this.scroller.scrollTo(position.x, position.y)
  }

  private applyPlugins() {
    const options = this.options
    BScrollConstructor.plugins
      .sort((a, b) => {
        const applyOrderMap = {
          [ApplyOrder.Pre]: -1,
          [ApplyOrder.Post]: 1,
        }
        const aOrder = a.applyOrder ? applyOrderMap[a.applyOrder] : 0
        const bOrder = b.applyOrder ? applyOrderMap[b.applyOrder] : 0
        return aOrder - bOrder
      })
      .forEach((item: PluginItem) => {
        const ctor = item.ctor
        if (options[item.name] && typeof ctor === 'function') {
          this.plugins[item.name] = new ctor(this)
        }
      })
  }

  private handleAutoBlur() {
    /* istanbul ignore if  */
    if (this.options.autoBlur) {
      this.on(this.eventTypes.beforeScrollStart, () => {
        let activeElement = document.activeElement as HTMLElement
        if (
          activeElement &&
          (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA')
        ) {
          activeElement.blur()
        }
      })
    }
  }

  private eventBubbling() {
    // 事件冒泡,当this.scroller.hooks的中 beforeScrollStart, scrollStart, scroll, scrollEnd, scrollCancel, touchEnd事件触发时冒泡并触发 this 的beforeScrollStart, scrollStart, scroll, scrollEnd, scrollCancel, touchEnd
    bubbling(this.scroller.hooks, this, [
      this.eventTypes.beforeScrollStart,
      this.eventTypes.scrollStart,
      this.eventTypes.scroll,
      this.eventTypes.scrollEnd,
      this.eventTypes.scrollCancel,
      this.eventTypes.touchEnd,
      this.eventTypes.flick,
    ])
  }

  private refreshWithoutReset(content: HTMLElement) {
    this.scroller.refresh(content)
    this.hooks.trigger(this.hooks.eventTypes.refresh, content)
    this.trigger(this.eventTypes.refresh, content)
  }

  proxy(propertiesConfig: PropertyConfig[]) {
    propertiesConfig.forEach(({ key, sourceKey }) => {
      propertiesProxy(this, sourceKey, key)
    })
  }
  refresh() {
    const { contentChanged, valid } = this.setContent(this.wrapper)
    if (valid) {
      const content = this.content
      this.refreshWithoutReset(content)
      if (contentChanged) {
        this.hooks.trigger(this.hooks.eventTypes.contentChanged, content)
        this.trigger(this.eventTypes.contentChanged, content)
      }
      this.scroller.resetPosition()
    }
  }

  enable() {
    this.scroller.enable()
    this.hooks.trigger(this.hooks.eventTypes.enable)
    this.trigger(this.eventTypes.enable)
  }

  disable() {
    this.scroller.disable()
    this.hooks.trigger(this.hooks.eventTypes.disable)
    this.trigger(this.eventTypes.disable)
  }

  destroy() {
    this.hooks.trigger(this.hooks.eventTypes.destroy)
    this.trigger(this.eventTypes.destroy)
    this.scroller.destroy()
  }
  eventRegister(names: string[]) {
    this.registerType(names)
  }
}

export interface BScrollConstructor extends BScrollInstance {}

export interface CustomAPI {
  [key: string]: {}
}

type ExtractAPI<O> = {
  [K in keyof O]: K extends string
    ? DefOptions[K] extends undefined
      ? CustomAPI[K]
      : never
    : never
}[keyof O]

export function createBScroll<O = {}>(
  el: ElementParam,
  options?: Options & O
): BScrollConstructor & UnionToIntersection<ExtractAPI<O>> {
  const bs = new BScrollConstructor(el, options)
  return (bs as unknown) as BScrollConstructor &
    UnionToIntersection<ExtractAPI<O>>
}

createBScroll.use = BScrollConstructor.use
createBScroll.plugins = BScrollConstructor.plugins
createBScroll.pluginsMap = BScrollConstructor.pluginsMap

type createBScroll = typeof createBScroll
export interface BScrollFactory extends createBScroll {
  new <O = {}>(el: ElementParam, options?: Options & O): BScrollConstructor &
    UnionToIntersection<ExtractAPI<O>>
}

export type BScroll<O = Options> = BScrollConstructor<O> &
  UnionToIntersection<ExtractAPI<O>>

export const BScroll = (createBScroll as unknown) as BScrollFactory
