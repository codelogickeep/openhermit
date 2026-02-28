import pino from 'pino';

// 过滤敏感信息
const sensitiveKeys = ['clientSecret', 'access_token', 'appsecret'];

// 拦截 process.stdout.write 过滤 SDK 内部输出
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  const str = chunk.toString();
  // 过滤钉钉 SDK 内部日志
  if (str.includes('Received message from dingtalk') || str.includes('<Buffer')) {
    if (callback) callback();
    return true;
  }
  return originalStdoutWrite(chunk, encoding, callback);
};

// 跳过的对象类型
const skipTypes = ['Buffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array'];

function filterSensitiveData(obj, depth = 0) {
  // 防止无限递归
  if (depth > 5) return '[深度嵌套]';

  if (!obj) return obj;

  // 跳过 Buffer 和 TypedArray
  const typeName = obj.constructor?.name;
  if (skipTypes.includes(typeName)) {
    return `[${typeName}]`;
  }

  // 跳过函数
  if (typeof obj === 'function') return '[Function]';

  // 跳过 Error 对象
  if (obj instanceof Error) {
    return { message: obj.message, stack: obj.stack };
  }

  const filtered = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    // 跳过原型链上的方法
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk.toLowerCase()))) {
      filtered[key] = '***';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      filtered[key] = filterSensitiveData(obj[key], depth + 1);
    } else if (typeof obj[key] === 'function') {
      continue; // 跳过函数
    } else {
      filtered[key] = obj[key];
    }
  }
  return filtered;
}

// 拦截 console.log，过滤敏感信息和 SDK 内部输出
const originalLog = console.log;
console.log = (...args) => {
  // 过滤钉钉 SDK 内部的 Buffer 输出
  const firstArg = args[0];
  if (typeof firstArg === 'string' && firstArg.includes('Received message')) {
    return; // 跳过 SDK 内部消息日志
  }

  // 跳过纯 Buffer 输出
  if (args.length === 1 && Buffer.isBuffer(args[0])) {
    return;
  }

  const filteredArgs = args.map(arg => {
    if (Buffer.isBuffer(arg)) {
      return '[Buffer]';
    }
    if (typeof arg === 'object') {
      return filterSensitiveData(arg);
    }
    return arg;
  });
  originalLog.apply(console, filteredArgs);
};

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname'
    }
  } : undefined
});

export default logger;
