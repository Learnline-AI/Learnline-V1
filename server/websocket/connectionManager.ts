// WebSocket Connection Manager for Session State and Health Monitoring
import { Socket } from 'socket.io';

interface ConnectionInfo {
  socket: Socket;
  sessionId: string;
  connectedAt: number;
  lastActivity: number;
  messageCount: number;
  bytesTransferred: number;
  errors: number;
  clientInfo?: {
    userAgent?: string;
    ip?: string;
    origin?: string;
  };
}

interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  totalMessages: number;
  totalBytesTransferred: number;
  totalErrors: number;
  averageSessionDuration: number;
  connectionsPerMinute: number;
}

export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private connectionHistory: Array<{ connectedAt: number; duration: number }> = [];
  private readonly MAX_CONNECTIONS_PER_USER = 10;
  private readonly CONNECTION_HISTORY_LIMIT = 1000;

  constructor() {
    console.log('🔧 Connection Manager: Initialized');
  }

  /**
   * Add a new WebSocket connection
   */
  addConnection(socket: Socket): boolean {
    const sessionId = socket.id;
    const now = Date.now();

    // Check if connection already exists
    if (this.connections.has(sessionId)) {
      console.warn(`⚠️ Connection: Duplicate session ID [${sessionId}]`);
      return false;
    }

    // Extract client information
    const clientInfo = {
      userAgent: socket.handshake.headers['user-agent'],
      ip: socket.handshake.address,
      origin: socket.handshake.headers.origin
    };

    // Create connection info
    const connectionInfo: ConnectionInfo = {
      socket,
      sessionId,
      connectedAt: now,
      lastActivity: now,
      messageCount: 0,
      bytesTransferred: 0,
      errors: 0,
      clientInfo
    };

    this.connections.set(sessionId, connectionInfo);

    // Setup connection monitoring
    this.setupConnectionMonitoring(socket, connectionInfo);

    console.log(`🔌 Connection: Added [${sessionId}] from ${clientInfo.ip} - Total: ${this.connections.size}`);
    return true;
  }

  /**
   * Remove a WebSocket connection
   */
  removeConnection(sessionId: string): boolean {
    const connectionInfo = this.connections.get(sessionId);
    
    if (!connectionInfo) {
      console.warn(`⚠️ Connection: Session not found for removal [${sessionId}]`);
      return false;
    }

    // Calculate session duration
    const duration = Date.now() - connectionInfo.connectedAt;
    
    // Add to connection history for analytics
    this.connectionHistory.push({
      connectedAt: connectionInfo.connectedAt,
      duration
    });

    // Limit history size
    if (this.connectionHistory.length > this.CONNECTION_HISTORY_LIMIT) {
      this.connectionHistory.shift();
    }

    // Remove from active connections
    this.connections.delete(sessionId);

    console.log(`🔌 Connection: Removed [${sessionId}] - Duration: ${Math.round(duration/1000)}s, Messages: ${connectionInfo.messageCount}, Bytes: ${Math.round(connectionInfo.bytesTransferred/1024)}KB, Errors: ${connectionInfo.errors}`);
    return true;
  }

  /**
   * Get connection by session ID
   */
  getConnection(sessionId: string): ConnectionInfo | null {
    return this.connections.get(sessionId) || null;
  }

  /**
   * Update connection activity and stats
   */
  updateActivity(sessionId: string, messageSize?: number): void {
    const connectionInfo = this.connections.get(sessionId);
    
    if (connectionInfo) {
      connectionInfo.lastActivity = Date.now();
      connectionInfo.messageCount++;
      
      if (messageSize) {
        connectionInfo.bytesTransferred += messageSize;
      }
    }
  }

  /**
   * Record an error for a connection
   */
  recordError(sessionId: string, error?: Error): void {
    const connectionInfo = this.connections.get(sessionId);
    
    if (connectionInfo) {
      connectionInfo.errors++;
      console.error(`❌ Connection: Error recorded for [${sessionId}] - Total errors: ${connectionInfo.errors}`, error?.message);
    }
  }

  /**
   * Broadcast message to a specific session
   */
  broadcastToSession(sessionId: string, event: string, data: any): boolean {
    const connectionInfo = this.connections.get(sessionId);
    
    if (connectionInfo) {
      connectionInfo.socket.emit(event, data);
      this.updateActivity(sessionId, JSON.stringify(data).length);
      return true;
    }
    
    return false;
  }

  /**
   * Broadcast message to all active connections
   */
  broadcastToAll(event: string, data: any): number {
    let sentCount = 0;
    const dataSize = JSON.stringify(data).length;
    
    for (const [sessionId, connectionInfo] of this.connections.entries()) {
      try {
        connectionInfo.socket.emit(event, data);
        this.updateActivity(sessionId, dataSize);
        sentCount++;
      } catch (error) {
        this.recordError(sessionId, error as Error);
      }
    }
    
    return sentCount;
  }

  /**
   * Get comprehensive connection statistics
   */
  getConnectionStats(): ConnectionStats {
    const now = Date.now();
    const activeConnections = this.connections.size;
    
    let totalMessages = 0;
    let totalBytesTransferred = 0;
    let totalErrors = 0;
    let totalSessionDuration = 0;

    // Calculate stats from active connections
    for (const connectionInfo of this.connections.values()) {
      totalMessages += connectionInfo.messageCount;
      totalBytesTransferred += connectionInfo.bytesTransferred;
      totalErrors += connectionInfo.errors;
      totalSessionDuration += (now - connectionInfo.connectedAt);
    }

    // Calculate average session duration from history
    let avgSessionDuration = 0;
    if (this.connectionHistory.length > 0) {
      const totalHistoricalDuration = this.connectionHistory.reduce((sum, conn) => sum + conn.duration, 0);
      avgSessionDuration = totalHistoricalDuration / this.connectionHistory.length;
    }

    // Calculate connections per minute (last 10 minutes)
    const tenMinutesAgo = now - (10 * 60 * 1000);
    const recentConnections = this.connectionHistory.filter(conn => conn.connectedAt > tenMinutesAgo);
    const connectionsPerMinute = recentConnections.length / 10;

    return {
      totalConnections: this.connectionHistory.length + activeConnections,
      activeConnections,
      totalMessages,
      totalBytesTransferred,
      totalErrors,
      averageSessionDuration: Math.round(avgSessionDuration / 1000), // Convert to seconds
      connectionsPerMinute: Math.round(connectionsPerMinute * 10) / 10 // Round to 1 decimal
    };
  }

  /**
   * Get health status of all connections
   */
  getHealthStatus(): Array<{
    sessionId: string;
    status: 'healthy' | 'inactive' | 'error-prone';
    lastActivity: number;
    timeSinceActivity: number;
    messageRate: number;
    errorRate: number;
  }> {
    const now = Date.now();
    const healthStatus: Array<any> = [];

    for (const connectionInfo of this.connections.values()) {
      const timeSinceActivity = now - connectionInfo.lastActivity;
      const sessionDuration = now - connectionInfo.connectedAt;
      const messageRate = connectionInfo.messageCount / (sessionDuration / 1000 / 60); // messages per minute
      const errorRate = connectionInfo.errors / Math.max(connectionInfo.messageCount, 1); // error percentage

      let status: 'healthy' | 'inactive' | 'error-prone' = 'healthy';
      
      if (timeSinceActivity > 60000) { // 1 minute inactive
        status = 'inactive';
      } else if (errorRate > 0.1) { // More than 10% error rate
        status = 'error-prone';
      }

      healthStatus.push({
        sessionId: connectionInfo.sessionId,
        status,
        lastActivity: connectionInfo.lastActivity,
        timeSinceActivity: Math.round(timeSinceActivity / 1000),
        messageRate: Math.round(messageRate * 10) / 10,
        errorRate: Math.round(errorRate * 1000) / 10 // As percentage
      });
    }

    return healthStatus;
  }

  /**
   * Clean up inactive connections
   */
  cleanupInactiveConnections(timeoutMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [sessionId, connectionInfo] of this.connections.entries()) {
      const timeSinceActivity = now - connectionInfo.lastActivity;
      
      if (timeSinceActivity > timeoutMs) {
        toRemove.push(sessionId);
      }
    }

    // Remove inactive connections
    for (const sessionId of toRemove) {
      this.removeConnection(sessionId);
    }

    if (toRemove.length > 0) {
      console.log(`🧹 Connection: Cleaned up ${toRemove.length} inactive connections`);
    }

    return toRemove.length;
  }

  /**
   * Check if user has too many connections (rate limiting)
   */
  checkConnectionLimit(clientIp: string): boolean {
    let connectionsFromIp = 0;
    
    for (const connectionInfo of this.connections.values()) {
      if (connectionInfo.clientInfo?.ip === clientIp) {
        connectionsFromIp++;
      }
    }

    return connectionsFromIp < this.MAX_CONNECTIONS_PER_USER;
  }

  /**
   * Setup connection monitoring for a socket
   */
  private setupConnectionMonitoring(socket: Socket, connectionInfo: ConnectionInfo): void {
    // Monitor socket events for activity tracking
    const originalEmit = socket.emit;
    socket.emit = function(event: string, ...args: any[]) {
      connectionInfo.lastActivity = Date.now();
      return originalEmit.apply(socket, [event, ...args]);
    };

    // Monitor incoming messages
    socket.onAny((event: string, ...args: any[]) => {
      connectionInfo.lastActivity = Date.now();
      connectionInfo.messageCount++;
      
      // Estimate message size
      try {
        const messageSize = JSON.stringify(args).length;
        connectionInfo.bytesTransferred += messageSize;
      } catch (error) {
        // Ignore serialization errors for size estimation
      }
    });

    // Monitor errors
    socket.on('error', (error) => {
      connectionInfo.errors++;
      console.error(`❌ Connection: Socket error [${connectionInfo.sessionId}]:`, error);
    });
  }

  /**
   * Get summary for logging/monitoring
   */
  getSummary(): string {
    const stats = this.getConnectionStats();
    return `Active: ${stats.activeConnections}, Total: ${stats.totalConnections}, Msgs: ${stats.totalMessages}, Errors: ${stats.totalErrors}, Avg Duration: ${stats.averageSessionDuration}s`;
  }

  /**
   * Graceful shutdown - disconnect all connections
   */
  async shutdown(): Promise<void> {
    console.log(`🔄 Connection Manager: Graceful shutdown - ${this.connections.size} active connections`);

    const disconnectPromises = Array.from(this.connections.keys()).map(sessionId => {
      return new Promise<void>((resolve) => {
        const connectionInfo = this.connections.get(sessionId);
        if (connectionInfo) {
          connectionInfo.socket.disconnect(true);
          resolve();
        } else {
          resolve();
        }
      });
    });

    await Promise.all(disconnectPromises);
    this.connections.clear();

    console.log('✅ Connection Manager: Shutdown complete');
  }
}