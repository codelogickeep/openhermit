import pino from 'pino';

// 过滤敏感信息
const sensitiveKeys = ['clientSecret', 'clientSecret', 'access_token', 'appsecret'];

function filterSensitiveData(obj) {
  if (!obj) return obj;
  const filtered = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk.toLowerCase()))) {
      filtered[key] = '***';
    } else if (typeof obj[key] === 'object') {
      filtered[key] = filterSensitiveData(obj[key]);
    } else {
      filtered[key] = obj[key];
    }
  }
  return filtered;
}

// 拦截 console.log，过滤敏感信息
const originalLog = console.log;
console.log = (...args) => {
  const filteredArgs = args.map(arg => {
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
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
});

export default logger;
