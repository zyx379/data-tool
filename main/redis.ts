import Redis from 'ioredis';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

let redisClient: Redis | null = null;

export function createRedisClient(config: RedisConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db || 0,
    enableReadyCheck: false,
  });
}

export async function testRedisConnection(config: RedisConfig): Promise<{ success: boolean; message: string }> {
  const client = createRedisClient(config);
  try {
    await client.ping();
    await client.quit();
    return { success: true, message: 'Redis 连接成功' };
  } catch (error) {
    await client.quit().catch(() => {});
    return { success: false, message: `Redis 连接失败: ${(error as Error).message}` };
  }
}

export async function getTokensFromRedis(config: RedisConfig, prefix: string = 'ONELINK:TOKEN:'): Promise<string[]> {
  const client = createRedisClient(config);
  try {
    console.log('=== Redis getTokensFromRedis ===');
    console.log('Prefix:', prefix);
    console.log('Config:', JSON.stringify(config));
    
    const keys = await client.keys(`${prefix}*`);
    console.log('Found keys count:', keys.length);
    console.log('Keys:', keys);
    
    if (keys.length === 0) {
      await client.quit();
      return [];
    }
    
    // 从 key 中提取 token（prefix 后面的部分）
    const tokens: string[] = [];
    for (const key of keys) {
      console.log(`Processing key: ${key}`);
      const type = await client.type(key);
      console.log(`  Type: ${type}`);
      
      // 从 key 中提取 token：去除前缀后剩余的部分
      const token = key.substring(prefix.length);
      tokens.push(token);
      console.log(`  Token from key:`, token.substring(0, 50) + '...');
    }
    
    console.log('Total tokens retrieved:', tokens.length);
    await client.quit();
    console.log('=== End getTokensFromRedis ===');
    return tokens;
  } catch (error) {
    await client.quit().catch(() => {});
    console.error('Redis error in getTokensFromRedis:', error);
    throw new Error(`获取 Token 失败: ${(error as Error).message}`);
  }
}

export async function getFirstTokenFromRedis(config: RedisConfig, prefix: string = 'ONELINK:TOKEN:'): Promise<string | null> {
  const tokens = await getTokensFromRedis(config, prefix);
  return tokens.length > 0 ? tokens[0] : null;
}

export async function getTokenByKey(config: RedisConfig, key: string, prefix: string = 'ONELINK:TOKEN:'): Promise<string | null> {
  const client = createRedisClient(config);
  try {
    console.log('=== Redis getTokenByKey ===');
    console.log('Key:', key);
    console.log('Prefix:', prefix);
    
    // 先检查 key 是否存在
    const exists = await client.exists(key);
    if (exists === 0) {
      console.log('Key does not exist');
      await client.quit();
      console.log('=== End getTokenByKey ===');
      return null;
    }
    
    // 从 key 中提取 token：去除前缀后剩余的部分
    let token: string | null = null;
    if (key.startsWith(prefix)) {
      token = key.substring(prefix.length);
      console.log('Token from key:', token ? token.substring(0, 50) + '...' : 'null');
    } else {
      console.warn('Key does not start with prefix:', prefix);
    }
    
    await client.quit();
    console.log('=== End getTokenByKey ===');
    return token;
  } catch (error) {
    await client.quit().catch(() => {});
    console.error('Redis error:', error);
    throw new Error(`获取 Token 失败: ${(error as Error).message}`);
  }
}