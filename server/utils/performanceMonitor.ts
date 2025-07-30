import * as os from 'os';
import { Request, Response, NextFunction } from 'express';

export interface CPUUsage {
  cores: number;
  percentage: number;
  loadAverage: number[];
}

export interface MemoryUsage {
  heapUsed: string;
  heapTotal: string;
  rss: string;
  external: string;
  systemTotal: string;
  percentage: number;
}

export interface RequestMetrics {
  active: number;
  total: number;
  averageResponseTime: number;
}

export interface Alert {
  type: 'cpu' | 'memory';
  level: 'warning' | 'critical';
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
}

export interface PerformanceMetric {
  timestamp: Date;
  cpu: CPUUsage;
  memory: MemoryUsage;
  requests: RequestMetrics;
  alerts: Alert[];
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private isEnabled: boolean = false;
  private logInterval: number = 10000;
  private cpuThreshold: number = 80;
  private memoryThreshold: number = 90;
  private requestCount: number = 0;
  private totalRequests: number = 0;
  private startTime: number = Date.now();
  private intervalId?: NodeJS.Timeout;
  private maxMetricsHistory: number = 100;
  private previousCpuUsage?: any;
  private requestTimes: number[] = [];

  constructor(config?: {
    enabled?: boolean;
    logInterval?: number;
    cpuThreshold?: number;
    memoryThreshold?: number;
    maxHistory?: number;
  }) {
    this.isEnabled = config?.enabled ?? true;
    this.logInterval = config?.logInterval ?? 10000;
    this.cpuThreshold = config?.cpuThreshold ?? 80;
    this.memoryThreshold = config?.memoryThreshold ?? 90;
    this.maxMetricsHistory = config?.maxHistory ?? 100;
  }

  public startMonitoring(): void {
    if (!this.isEnabled) {
      console.log('🔍 Performance monitoring is disabled');
      return;
    }

    console.log(`🚀 Starting performance monitoring (interval: ${this.logInterval}ms)`);
    
    try {
      this.previousCpuUsage = process.cpuUsage();
      this.intervalId = setInterval(() => {
        this.collectAndLogMetrics();
      }, this.logInterval);
    } catch (error) {
      console.error('❌ Failed to start performance monitoring:', error);
    }
  }

  public stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      console.log('⏹️ Performance monitoring stopped');
    }
  }

  public addRequest(): void {
    this.requestCount++;
    this.totalRequests++;
  }

  public removeRequest(responseTime: number): void {
    this.requestCount = Math.max(0, this.requestCount - 1);
    this.requestTimes.push(responseTime);
    
    if (this.requestTimes.length > 1000) {
      this.requestTimes = this.requestTimes.slice(-500);
    }
  }

  public getMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!this.isEnabled) {
        return next();
      }

      const startTime = Date.now();
      this.addRequest();

      const originalEnd = res.end;
      res.end = function(this: Response, chunk?: any, encoding?: BufferEncoding | (() => void), cb?: () => void) {
        const responseTime = Date.now() - startTime;
        (req as any).performanceMonitor?.removeRequest(responseTime);
        return originalEnd.call(this, chunk, encoding as BufferEncoding, cb);
      };

      (req as any).performanceMonitor = this;
      next();
    };
  }

  private getCPUUsage(): CPUUsage {
    try {
      const currentUsage = process.cpuUsage();
      const cores = os.cpus().length;
      const loadAverage = os.loadavg();
      
      let percentage = 0;
      
      if (this.previousCpuUsage) {
        const userDiff = currentUsage.user - this.previousCpuUsage.user;
        const systemDiff = currentUsage.system - this.previousCpuUsage.system;
        const totalDiff = userDiff + systemDiff;
        
        const intervalMicroseconds = this.logInterval * 1000;
        percentage = Math.min(100, (totalDiff / intervalMicroseconds) * 100);
      }
      
      this.previousCpuUsage = currentUsage;

      return {
        cores,
        percentage: Math.round(percentage * 100) / 100,
        loadAverage
      };
    } catch (error) {
      console.error('❌ Failed to get CPU usage:', error);
      return {
        cores: 1,
        percentage: 0,
        loadAverage: [0, 0, 0]
      };
    }
  }

  private getMemoryUsage(): MemoryUsage {
    try {
      const memUsage = process.memoryUsage();
      const systemTotal = os.totalmem();
      const systemFree = os.freemem();
      const systemUsed = systemTotal - systemFree;
      const percentage = (systemUsed / systemTotal) * 100;

      return {
        heapUsed: this.formatBytes(memUsage.heapUsed),
        heapTotal: this.formatBytes(memUsage.heapTotal),
        rss: this.formatBytes(memUsage.rss),
        external: this.formatBytes(memUsage.external),
        systemTotal: this.formatBytes(systemTotal),
        percentage: Math.round(percentage * 100) / 100
      };
    } catch (error) {
      console.error('❌ Failed to get memory usage:', error);
      return {
        heapUsed: '0 MB',
        heapTotal: '0 MB',
        rss: '0 MB',
        external: '0 MB',
        systemTotal: '0 MB',
        percentage: 0
      };
    }
  }

  private getRequestMetrics(): RequestMetrics {
    const averageResponseTime = this.requestTimes.length > 0 
      ? this.requestTimes.reduce((sum, time) => sum + time, 0) / this.requestTimes.length
      : 0;

    return {
      active: this.requestCount,
      total: this.totalRequests,
      averageResponseTime: Math.round(averageResponseTime * 100) / 100
    };
  }

  private checkAlerts(cpu: CPUUsage, memory: MemoryUsage): Alert[] {
    const alerts: Alert[] = [];

    if (cpu.percentage > this.cpuThreshold) {
      alerts.push({
        type: 'cpu',
        level: cpu.percentage > 95 ? 'critical' : 'warning',
        value: cpu.percentage,
        threshold: this.cpuThreshold,
        message: `High CPU usage: ${cpu.percentage}%`,
        timestamp: new Date()
      });
    }

    if (memory.percentage > this.memoryThreshold) {
      alerts.push({
        type: 'memory',
        level: memory.percentage > 95 ? 'critical' : 'warning',
        value: memory.percentage,
        threshold: this.memoryThreshold,
        message: `High memory usage: ${memory.percentage}%`,
        timestamp: new Date()
      });
    }

    return alerts;
  }

  private collectAndLogMetrics(): void {
    try {
      const cpu = this.getCPUUsage();
      const memory = this.getMemoryUsage();
      const requests = this.getRequestMetrics();
      const alerts = this.checkAlerts(cpu, memory);

      const metric: PerformanceMetric = {
        timestamp: new Date(),
        cpu,
        memory,
        requests,
        alerts
      };

      this.metrics.push(metric);
      
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics = this.metrics.slice(-this.maxMetricsHistory);
      }

      this.logMetrics(metric);

      if (alerts.length > 0) {
        this.logAlerts(alerts);
      }
    } catch (error) {
      console.error('❌ Failed to collect performance metrics:', error);
    }
  }

  private logMetrics(metric: PerformanceMetric): void {
    const uptime = this.formatUptime(Date.now() - this.startTime);
    
    console.log(`
📊 Performance Metrics [${metric.timestamp.toISOString()}]
├── Uptime: ${uptime}
├── CPU: ${metric.cpu.percentage}% (${metric.cpu.cores} cores, load: [${metric.cpu.loadAverage.map(l => l.toFixed(2)).join(', ')}])
├── Memory: ${metric.memory.percentage}% (Heap: ${metric.memory.heapUsed}/${metric.memory.heapTotal}, System: ${metric.memory.systemTotal})
└── Requests: ${metric.requests.active} active, ${metric.requests.total} total, ${metric.requests.averageResponseTime}ms avg
    `);
  }

  private logAlerts(alerts: Alert[]): void {
    alerts.forEach(alert => {
      const emoji = alert.level === 'critical' ? '🚨' : '⚠️';
      console.log(`${emoji} ${alert.level.toUpperCase()} ALERT: ${alert.message}`);
    });
  }

  private formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb * 100) / 100} MB`;
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  public getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  public getLatestMetric(): PerformanceMetric | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }
}

export const performanceMonitor = new PerformanceMonitor({
  enabled: process.env.PERFORMANCE_MONITORING_ENABLED !== 'false',
  logInterval: parseInt(process.env.PERFORMANCE_LOG_INTERVAL || '10000'),
  cpuThreshold: parseInt(process.env.PERFORMANCE_CPU_THRESHOLD || '80'),
  memoryThreshold: parseInt(process.env.PERFORMANCE_MEMORY_THRESHOLD || '90'),
  maxHistory: parseInt(process.env.PERFORMANCE_MAX_HISTORY || '100')
});