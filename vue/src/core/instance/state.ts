import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'
import { initSetup } from 'v3/apiSetup'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  isArray,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling,
  isFunction
} from '../util/index'
import type { Component } from 'types/component'
import { shallowReactive, TrackOpTypes } from 'v3'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy(target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter() {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter(val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState(vm: Component) {
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)

  // 初始化setup 因为是vue2.7了，所以会有setup出现
  initSetup(vm)
  // 方法  处理命名问题，绑定this指向
  if (opts.methods) initMethods(vm, opts.methods)
  // 数据
  if (opts.data) {
    initData(vm)
  } else {
    const ob = observe((vm._data = {}))
    ob && ob.vmCount++
  }
  // 计算属性
  if (opts.computed) initComputed(vm, opts.computed)
  // watch属性
  // 边缘情况排除：火狐Object.prototype上有个watch函数，nativeWatch = {}.watch
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}

function initProps(vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = (vm._props = shallowReactive({}))
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys: string[] = (vm.$options._propKeys = [])
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (__DEV__) {
      const hyphenatedKey = hyphenate(key)
      if (
        isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)
      ) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
              `overwritten whenever the parent component re-renders. ` +
              `Instead, use a data or computed property based on the prop's ` +
              `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData(vm: Component) {
  // 拿到用户定义的data
  let data: any = vm.$options.data
  // 是函数就执行，不是就直接用
  // getData会触发依赖收集
  data = vm._data = isFunction(data) ? getData(data, vm) : data || {}
  // data不是对象类型，说明之前是函数类型，但没有返回对象
  if (!isPlainObject(data)) {
    data = {}
    __DEV__ &&
      warn(
        'data functions should return an object:\n' +
          'https://v2.vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
        vm
      )
  }
  // 最后data会处理成一个对象
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  // 命名检验
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (__DEV__) {
      if (methods && hasOwn(methods, key)) {
        warn(`Method "${key}" has already been defined as a data property.`, vm)
      }
    }
    if (props && hasOwn(props, key)) {
      __DEV__ &&
        warn(
          `The data property "${key}" is already declared as a prop. ` +
            `Use prop default value instead.`,
          vm
        )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }
  // 生成Observer放到自身__ob__上
  const ob = observe(data)
  ob && ob.vmCount++
}

export function getData(data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e: any) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { lazy: true }

function initComputed(vm: Component, computed: Object) {
  // 获取计算属性相关的watcher
  const watchers = (vm._computedWatchers = Object.create(null))

  // computed properties are just getters during SSR
  const isSSR = isServerRendering()
  // 枚举
  for (const key in computed) {
    const userDef = computed[key]
    // 统一格式，使用getter
    const getter = isFunction(userDef) ? userDef : userDef.get
    // 开发警告：computed无getter
    if (__DEV__ && getter == null) {
      warn(`Getter is missing for computed property "${key}".`, vm)
    }
    // 非ssr
    if (!isSSR) {
      // 为computed属性创建内部watcher
      // vm: Component | null,
      // expOrFn: string | (() => any),
      // cb: Function,
      // options?: WatcherOptions | null,
      // isRenderWatcher?: boolean
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    // 不在vm实例上同名的属性才可以defineComputed
    if (!(key in vm)) {
      // 设置描述器
      // enumerable: true,
      // configurable: true,
      // get: userDef,
      // set: noop  不允许设置
      defineComputed(vm, key, userDef)
    } else if (__DEV__) {
      // 计算属性名字的检验，不能和实例上，$data,props,methods相同
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      } else if (vm.$options.methods && key in vm.$options.methods) {
        warn(
          `The computed property "${key}" is already defined as a method.`,
          vm
        )
      }
    }
  }
}

export function defineComputed(
  target: any,
  key: string,
  userDef: Record<string, any> | (() => any)
) {
  // 默认缓存，ssr不缓存
  const shouldCache = !isServerRendering()
  // 检验getter类型，需要是function
  if (isFunction(userDef)) {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    sharedPropertyDefinition.set = userDef.set || noop
  }
  if (__DEV__ && sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

function createComputedGetter(key) {
  return function computedGetter() {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      if (watcher.dirty) {
        watcher.evaluate()
      }
      if (Dep.target) {
        if (__DEV__ && Dep.target.onTrack) {
          Dep.target.onTrack({
            effect: Dep.target,
            target: this,
            type: TrackOpTypes.GET,
            key
          })
        }
        watcher.depend()
      }
      return watcher.value
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter() {
    return fn.call(this, this)
  }
}

function initMethods(vm: Component, methods: Object) {
  // 拿到父传过来的属性
  const props = vm.$options.props
  for (const key in methods) {
    // 开发模式的友好警告
    if (__DEV__) {
      // 警告：非函数类型
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[
            key
          ]}" in the component definition. ` +
            `Did you reference the function correctly?`,
          vm
        )
      }
      // 警告：props已经相同名字了
      if (props && hasOwn(props, key)) {
        warn(`Method "${key}" has already been defined as a prop.`, vm)
      }
      // 警告：与实例上其他属性重名
      if (key in vm && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
            `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    // 不是函数就设置个空函数，是函数就把this指向当前组件实例
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

function initWatch(vm: Component, watch: Object) {
  for (const key in watch) {
    /**
     * watch
     * 写法1 watch:{ a:{ handler(){}, deep:true, immediate } }
     * 写法2 watch:{ a(){}}   }
     * 写法3 watch:{ a:[function(){}, function(){}] }
     * 写法4 watch:{ b: "watchB", }  watchB是methods上的方法
     */
    const handler = watch[key]
    if (isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher(
  vm: Component,
  expOrFn: string | (() => any),
  handler: any,
  options?: Object
) {
  // === '[object Object]'  初始化options 输出 { handler:Function }
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  // 在 new Vue 之前，stateMixin 已经在原型上设置了$watch方法 具体实现就在下一个函数
  // expOrFn 在组件时是watch的key的name,也可以是函数，具体是做什么的，还不知道
  // handler 是watch回调，是个函数
  // options是 { handler:Function,depp?:boolean, immediate?:boolean}
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin(Vue: typeof Component) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef: any = {}
  dataDef.get = function () {
    return this._data
  }
  const propsDef: any = {}
  propsDef.get = function () {
    return this._props
  }
  if (__DEV__) {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
          'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  Vue.prototype.$watch = function (
    expOrFn: string | (() => any),
    cb: any,
    options?: Record<string, any>
  ): Function {
    const vm: Component = this
    // === '[object Object]' cb指watch的handler
    if (isPlainObject(cb)) {
      // 交给createWatcher去处理cb是对象的情况，具体他会拿里面的handler再走进$watch
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    options.user = true
    // 创建watcher watch里面每个key都创建一个
    const watcher = new Watcher(vm, expOrFn, cb, options)
    // 立即执行
    if (options.immediate) {
      const info = `callback for immediate watcher "${watcher.expression}"`
      pushTarget()
      // 调用错误捕获 cb可以是watch的handler 第三个 参数就是watcher的旧值
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info)
      popTarget()
    }
    // 取消watch的函数
    return function unwatchFn() {
      watcher.teardown()
    }
  }
}
