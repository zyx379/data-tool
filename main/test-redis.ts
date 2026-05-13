import Redis from 'ioredis';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

function createRedisClient(config: RedisConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db || 0,
    retryStrategy: (times) => {
      if (times > 3) {
        return null;
      }
      return Math.min(times * 100, 3000);
    },
  });
}

async function testGetKeyValue(client: Redis, key: string): Promise<string | null> {
  const type = await client.type(key);
  console.log(`  Key: ${key}, Type: ${type}`);
  
  switch (type) {
    case 'string':
      return await client.get(key);
    case 'hash':
      const hashAll = await client.hgetall(key);
      const firstKey = Object.keys(hashAll || {})[0];
      console.log(`    Hash fields: ${JSON.stringify(hashAll)}`);
      return hashAll && firstKey ? hashAll[firstKey] : null;
    case 'list':
      const listValue = await client.lindex(key, 0);
      return listValue;
    case 'set':
      const members = await client.smembers(key);
      return members.length > 0 ? members[0] : null;
    case 'zset':
      const zrange = await client.zrange(key, -1, -1);
      return zrange.length > 0 ? zrange[0] : null;
    default:
      console.log(`    Unsupported type: ${type}`);
      return null;
  }
}

async function testRedis() {
  const config: RedisConfig = {
    host: process.argv[2] || 'localhost',
    port: parseInt(process.argv[3]) || 6379,
    password: process.argv[4] || undefined,
    db: parseInt(process.argv[5]) || 0,
  };

  console.log('Redis Test Configuration:');
  console.log(JSON.stringify(config, null, 2));
  console.log();

  const client = createRedisClient(config);

  try {
    // 测试连接
    console.log('Testing connection...');
    const ping = await client.ping();
    console.log(`✓ Connection successful: ${ping}\n`);

    // 查找匹配前缀的 key
    const prefix = process.argv[6] || 'ONELINK:TOKEN:';
    console.log(`Searching for keys with prefix: ${prefix}`);
    
    const keys = await client.keys(`${prefix}*`);
    console.log(`Found ${keys.length} keys\n`);

    if (keys.length === 0) {
      console.log('No keys found with the specified prefix.');
      
      // 列出所有 key 作为调试
      console.log('\nListing all keys (first 20):');
      const allKeys = await client.keys('*');
      console.log(`Total keys in Redis: ${allKeys.length}`);
      allKeys.slice(0, 20).forEach(key => console.log(`  - ${key}`));
    } else {
      console.log('Key details:');
      for (const key of keys.slice(0, 5)) { // 只显示前5个
        const value = await testGetKeyValue(client, key);
        console.log(`    Value: ${value ? value.substring(0, 50) + '...' : 'null'}`);
        console.log();
      }
      
      // 获取第一个 Token
      console.log('Getting first token...');
      const firstKey = keys[0];
      const value = await testGetKeyValue(client, firstKey);
      console.log(`\n✓ First Token retrieved successfully!`);
      console.log(`Key: ${firstKey}`);
      console.log(`Value: ${value}`);
    }

  } catch (error) {
    console.error('✗ Error:', (error as Error).message);
    process.exit(1);
  } finally {
    await client.quit();
  }
}

// 运行测试
testRedis();
