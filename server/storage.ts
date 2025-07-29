import { users, type User, type InsertUser, type RagQueryHistory, type InsertRagQueryHistory } from "@shared/schema";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  // RAG query history methods
  logRagQuery(queryData: InsertRagQueryHistory): Promise<RagQueryHistory>;
  getRagQueryHistory(userId: number, limit?: number): Promise<RagQueryHistory[]>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private ragQueries: Map<number, RagQueryHistory>;
  currentId: number;
  ragQueryId: number;

  constructor() {
    this.users = new Map();
    this.ragQueries = new Map();
    this.currentId = 1;
    this.ragQueryId = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async logRagQuery(queryData: InsertRagQueryHistory): Promise<RagQueryHistory> {
    const id = this.ragQueryId++;
    const ragQuery: RagQueryHistory = { 
      ...queryData, 
      id,
      createdAt: new Date()
    };
    this.ragQueries.set(id, ragQuery);
    return ragQuery;
  }

  async getRagQueryHistory(userId: number, limit: number = 10): Promise<RagQueryHistory[]> {
    const queries = Array.from(this.ragQueries.values())
      .filter(query => query.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    return queries;
  }
}

export const storage = new MemStorage();
