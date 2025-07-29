// Error Monitoring and Recovery System for RNNoise Integration
// Provides centralized error tracking, recovery strategies, and actionable insights

interface ErrorEvent {
  id: string;
  timestamp: number;
  component: 'rnnoise-server' | 'rnnoise-client' | 'vad-service' | 'audio-processing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorType: string;
  message: string;
  stack?: string;
  context: Record<string, any>;
  resolved: boolean;
  resolution?: string;
  recoveryAction?: string;
}

interface ComponentHealth {
  component: string;
  status: 'healthy' | 'degraded' | 'failing' | 'offline';
  lastError?: ErrorEvent;
  errorRate: number;
  successRate: number;
  averageLatency: number;
  lastHealthCheck: number;
}

interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'failing' | 'offline';
  components: ComponentHealth[];
  rnnoiseEnabled: boolean;
  fallbackActive: boolean;
  recommendations: string[];
}

export class ErrorMonitoringService {
  private errors: Map<string, ErrorEvent> = new Map();
  private componentStats: Map<string, ComponentHealth> = new Map();
  private errorRateWindows: Map<string, number[]> = new Map();
  private readonly maxErrors = 1000; // Keep last 1000 errors
  private readonly windowSize = 300000; // 5 minutes window for error rate calculation
  private readonly debug: boolean;

  constructor() {
    this.debug = process.env.RNNOISE_DEBUG === 'true';
    
    // Initialize component health tracking
    this.initializeComponentHealth();
    
    // Start periodic health checks
    this.startHealthChecks();
    
    if (this.debug) {
      console.log('🔍 ErrorMonitoring: Service initialized');
    }
  }

  private initializeComponentHealth(): void {
    const components = ['rnnoise-server', 'rnnoise-client', 'vad-service', 'audio-processing'];
    
    components.forEach(component => {
      this.componentStats.set(component, {
        component,
        status: 'healthy',
        errorRate: 0,
        successRate: 100,
        averageLatency: 0,
        lastHealthCheck: Date.now()
      });
      
      this.errorRateWindows.set(component, []);
    });
  }

  private startHealthChecks(): void {
    // Check system health every 30 seconds
    setInterval(() => {
      this.performHealthCheck();
    }, 30000);
    
    // Clean up old errors every 10 minutes
    setInterval(() => {
      this.cleanupOldErrors();
    }, 600000);
  }

  /**
   * Log an error event with context and automatic recovery suggestions
   */
  logError(
    component: ErrorEvent['component'],
    severity: ErrorEvent['severity'],
    errorType: string,
    message: string,
    context: Record<string, any> = {},
    error?: Error
  ): string {
    const errorId = this.generateErrorId();
    const timestamp = Date.now();

    const errorEvent: ErrorEvent = {
      id: errorId,
      timestamp,
      component,
      severity,
      errorType,
      message,
      stack: error?.stack,
      context: {
        ...context,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
        timestamp: new Date(timestamp).toISOString()
      },
      resolved: false
    };

    // Add recovery suggestions
    errorEvent.recoveryAction = this.getRecoveryAction(component, errorType, context);

    // Store the error
    this.errors.set(errorId, errorEvent);

    // Update component health
    this.updateComponentHealth(component, false, context.processingTime || 0);

    // Update error rate tracking
    this.updateErrorRate(component, timestamp);

    // Log to console based on severity
    this.logToConsole(errorEvent);

    // Check if immediate action is needed
    this.checkForCriticalConditions(component, errorEvent);

    return errorId;
  }

  /**
   * Log a successful operation for component health tracking
   */
  logSuccess(
    component: ErrorEvent['component'],
    processingTime: number = 0,
    context: Record<string, any> = {}
  ): void {
    this.updateComponentHealth(component, true, processingTime);
    
    if (this.debug && Math.random() < 0.01) { // Log 1% of successes for debugging
      console.log(`✅ ErrorMonitoring: ${component} success (${processingTime.toFixed(2)}ms)`);
    }
  }

  /**
   * Mark an error as resolved with resolution details
   */
  resolveError(errorId: string, resolution: string): boolean {
    const error = this.errors.get(errorId);
    if (error) {
      error.resolved = true;
      error.resolution = resolution;
      
      if (this.debug) {
        console.log(`✅ ErrorMonitoring: Error ${errorId} resolved: ${resolution}`);
      }
      
      return true;
    }
    return false;
  }

  /**
   * Get current system health status
   */
  getSystemHealth(): SystemHealth {
    const components = Array.from(this.componentStats.values());
    const failingComponents = components.filter(c => c.status === 'failing' || c.status === 'offline');
    const degradedComponents = components.filter(c => c.status === 'degraded');

    let overall: SystemHealth['overall'] = 'healthy';
    if (failingComponents.length > 0) {
      overall = 'failing';
    } else if (degradedComponents.length > 0) {
      overall = 'degraded';
    }

    const recommendations = this.generateRecommendations(components);
    const rnnoiseServer = this.componentStats.get('rnnoise-server');
    const rnnoiseClient = this.componentStats.get('rnnoise-client');

    return {
      overall,
      components,
      rnnoiseEnabled: (rnnoiseServer?.status !== 'offline') || (rnnoiseClient?.status !== 'offline'),
      fallbackActive: overall !== 'healthy',
      recommendations
    };
  }

  /**
   * Get error history for a specific component
   */
  getComponentErrors(component: string, limit: number = 50): ErrorEvent[] {
    return Array.from(this.errors.values())
      .filter(error => error.component === component)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get unresolved errors across all components
   */
  getUnresolvedErrors(): ErrorEvent[] {
    return Array.from(this.errors.values())
      .filter(error => !error.resolved)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Generate diagnostic report for debugging
   */
  generateDiagnosticReport(): string {
    const health = this.getSystemHealth();
    const unresolvedErrors = this.getUnresolvedErrors();
    
    let report = `
# RNNoise Integration Diagnostic Report
Generated: ${new Date().toISOString()}

## System Health: ${health.overall.toUpperCase()}
- RNNoise Enabled: ${health.rnnoiseEnabled}
- Fallback Active: ${health.fallbackActive}

## Component Status:
${health.components.map(c => `- ${c.component}: ${c.status.toUpperCase()} (${c.successRate.toFixed(1)}% success, ${c.averageLatency.toFixed(2)}ms avg)`).join('\n')}

## Recommendations:
${health.recommendations.map(r => `- ${r}`).join('\n')}

## Recent Unresolved Errors:
${unresolvedErrors.slice(0, 10).map(e => `- [${e.severity.toUpperCase()}] ${e.component}: ${e.message}`).join('\n')}

## Recovery Actions:
${unresolvedErrors.slice(0, 5).map(e => `- ${e.component}: ${e.recoveryAction || 'No automatic recovery available'}`).join('\n')}
`;

    return report.trim();
  }

  private updateComponentHealth(component: string, success: boolean, processingTime: number): void {
    const health = this.componentStats.get(component);
    if (!health) return;

    const now = Date.now();
    const window = this.errorRateWindows.get(component) || [];
    
    // Update success/error rates (simple moving average)
    const totalOps = (health.successRate + health.errorRate) || 1;
    if (success) {
      health.successRate = ((health.successRate * totalOps) + 100) / (totalOps + 1);
      health.errorRate = (health.errorRate * totalOps) / (totalOps + 1);
    } else {
      health.errorRate = ((health.errorRate * totalOps) + 100) / (totalOps + 1);
      health.successRate = (health.successRate * totalOps) / (totalOps + 1);
    }

    // Update average latency
    if (processingTime > 0) {
      health.averageLatency = (health.averageLatency + processingTime) / 2;
    }

    // Update status based on metrics
    if (!success) {
      window.push(now);
    }

    // Determine health status
    if (health.errorRate > 50) {
      health.status = 'failing';
    } else if (health.errorRate > 20) {
      health.status = 'degraded';
    } else if (health.averageLatency > 1000) {
      health.status = 'degraded';
    } else {
      health.status = 'healthy';
    }

    health.lastHealthCheck = now;
  }

  private updateErrorRate(component: string, timestamp: number): void {
    const window = this.errorRateWindows.get(component);
    if (!window) return;

    window.push(timestamp);
    
    // Remove errors outside of the time window
    const cutoff = timestamp - this.windowSize;
    const filteredWindow = window.filter(t => t > cutoff);
    this.errorRateWindows.set(component, filteredWindow);
  }

  private getRecoveryAction(component: string, errorType: string, context: Record<string, any>): string {
    const actions: Record<string, string> = {
      'initialization_failed': 'Check if RNNoise WASM files are accessible and browser supports WebAssembly',
      'processing_timeout': 'Reduce audio chunk size or increase timeout threshold',
      'memory_error': 'Clear audio buffers and restart RNNoise service',
      'wasm_load_failed': 'Verify network connectivity and RNNoise package installation',
      'audio_format_error': 'Check audio sample rate and format compatibility',
      'provider_unavailable': 'Switch to fallback provider or disable RNNoise temporarily',
      'consecutive_errors': 'Reset RNNoise service and clear error counters',
      'high_latency': 'Consider disabling RNNoise for this session or reduce processing quality'
    };

    const baseAction = actions[errorType] || 'Check logs for specific error details and consider service restart';
    
    // Add context-specific suggestions
    if (context.processingTime > 500) {
      return `${baseAction}. High latency detected (${context.processingTime}ms) - consider optimizing audio processing.`;
    }
    
    if (context.audioLength === 0) {
      return `${baseAction}. Empty audio detected - verify microphone input and permissions.`;
    }

    return baseAction;
  }

  private generateRecommendations(components: ComponentHealth[]): string[] {
    const recommendations: string[] = [];
    
    components.forEach(component => {
      if (component.status === 'failing') {
        recommendations.push(`${component.component} is failing - consider disabling temporarily`);
      } else if (component.status === 'degraded') {
        recommendations.push(`${component.component} performance degraded - monitor closely`);
      }
      
      if (component.averageLatency > 200) {
        recommendations.push(`${component.component} has high latency (${component.averageLatency.toFixed(2)}ms) - optimize processing`);
      }
      
      if (component.errorRate > 10) {
        recommendations.push(`${component.component} error rate is ${component.errorRate.toFixed(1)}% - investigate root cause`);
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('All components operating normally');
    }

    return recommendations;
  }

  private logToConsole(error: ErrorEvent): void {
    const prefix = `❌ ErrorMonitoring [${error.severity.toUpperCase()}]`;
    const message = `${error.component}: ${error.message}`;
    
    switch (error.severity) {
      case 'critical':
        console.error(`${prefix} CRITICAL: ${message}`, error.context);
        break;
      case 'high':
        console.error(`${prefix} ${message}`, error.context);
        break;
      case 'medium':
        console.warn(`${prefix} ${message}`);
        break;
      case 'low':
        if (this.debug) {
          console.log(`${prefix} ${message}`);
        }
        break;
    }
  }

  private checkForCriticalConditions(component: string, error: ErrorEvent): void {
    const health = this.componentStats.get(component);
    if (!health) return;

    // Check for critical error rates
    const errorWindow = this.errorRateWindows.get(component) || [];
    const recentErrors = errorWindow.filter(t => Date.now() - t < 60000); // Last minute
    
    if (recentErrors.length > 10) {
      console.error(`🚨 ErrorMonitoring: CRITICAL - ${component} has ${recentErrors.length} errors in the last minute!`);
      console.error(`🔧 Recommended action: ${error.recoveryAction}`);
    }

    // Check for cascading failures
    const failingComponents = Array.from(this.componentStats.values())
      .filter(c => c.status === 'failing').length;
    
    if (failingComponents > 1) {
      console.error('🚨 ErrorMonitoring: SYSTEM CRITICAL - Multiple components failing!');
      console.error('🔧 Consider disabling RNNoise entirely and using fallback audio processing');
    }
  }

  private performHealthCheck(): void {
    const now = Date.now();
    let unhealthyComponents = 0;
    
    this.componentStats.forEach((health, component) => {
      // Check if component hasn't reported in a while
      if (now - health.lastHealthCheck > 120000) { // 2 minutes
        health.status = 'offline';
        unhealthyComponents++;
      }
      
      // Log health status changes
      if (health.status !== 'healthy' && this.debug) {
        console.log(`🔍 ErrorMonitoring: ${component} status: ${health.status} (${health.successRate.toFixed(1)}% success)`);
      }
    });

    if (unhealthyComponents > 0 && this.debug) {
      console.log(`🔍 ErrorMonitoring: Health check complete - ${unhealthyComponents} unhealthy components`);
    }
  }

  private cleanupOldErrors(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    let removedCount = 0;

    this.errors.forEach((error, id) => {
      if (error.timestamp < cutoff) {
        this.errors.delete(id);
        removedCount++;
      }
    });

    // Also limit total errors
    if (this.errors.size > this.maxErrors) {
      const sortedErrors = Array.from(this.errors.entries())
        .sort(([,a], [,b]) => b.timestamp - a.timestamp);
      
      // Keep only the most recent errors
      sortedErrors.slice(this.maxErrors).forEach(([id]) => {
        this.errors.delete(id);
        removedCount++;
      });
    }

    if (removedCount > 0 && this.debug) {
      console.log(`🧹 ErrorMonitoring: Cleaned up ${removedCount} old errors`);
    }
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Global singleton instance
let errorMonitoringService: ErrorMonitoringService | null = null;

export function getErrorMonitoringService(): ErrorMonitoringService {
  if (!errorMonitoringService) {
    errorMonitoringService = new ErrorMonitoringService();
  }
  return errorMonitoringService;
}

// Convenience functions for common error logging
export function logRNNoiseError(
  location: 'server' | 'client',
  severity: ErrorEvent['severity'],
  errorType: string,
  message: string,
  context: Record<string, any> = {},
  error?: Error
): void {
  const component = location === 'server' ? 'rnnoise-server' : 'rnnoise-client';
  getErrorMonitoringService().logError(component, severity, errorType, message, context, error);
}

export function logRNNoiseSuccess(
  location: 'server' | 'client',
  processingTime: number,
  context: Record<string, any> = {}
): void {
  const component = location === 'server' ? 'rnnoise-server' : 'rnnoise-client';
  getErrorMonitoringService().logSuccess(component, processingTime, context);
}

// Export types
export type { ErrorEvent, ComponentHealth, SystemHealth };