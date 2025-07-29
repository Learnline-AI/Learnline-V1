import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types for the RAG embedding file
interface RagEmbeddingFile {
  metadata: {
    total_chunks: number;
    embedding_dimension: number;
    timestamp: string;
    processing_model: string;
  };
  chunks: RagChunk[];
}

interface RagChunk {
  id: string;
  type: "activity" | "example" | "content" | "special_box";
  section: string;
  content: string;
  prepared_text: string;
  embedding: number[];
  ai_metadata: {
    learning_objectives?: string[];
    concepts?: string[];
    main_concepts?:
      | Array<{ concept: string; importance: string; definition?: string }>
      | string[];
    concepts_demonstrated?: string[];
    difficulty_level?: "beginner" | "intermediate" | "advanced";
    cognitive_level?: "remember" | "understand" | "apply" | "analyze";
    real_world_examples?: string[];
    real_world_connections?: string[];
    common_misconceptions?: string[];
    misconceptions_addressed?: string[];
    prerequisites?: string[];
    prerequisite_knowledge?: string[];
    solution_strategy?: string;
    key_formulas?: string[];
    mathematical_elements?: Array<{
      element: string;
      complexity: string;
      required_skills: string[];
    }>;
    figure_analysis?: Array<{
      figure: string;
      purpose: string;
      educational_value: string;
    }>;
    materials_needed?: string[];
    key_definitions?: Record<string, string>;
    thinking_skills?: string[];
    [key: string]: any;
  };
  quality_score: number;
}

interface SimilarityResult {
  chunk: RagChunk;
  similarity: number;
  metadataRelevanceScore: number;
}

interface QuestionAnalysis {
  type:
    | "conceptual"
    | "procedural"
    | "application"
    | "troubleshooting"
    | "example_seeking"
    | "comparison";
  intent:
    | "definition"
    | "calculation"
    | "explanation"
    | "examples"
    | "confusion"
    | "application"
    | "verification";
  complexity: "basic" | "intermediate" | "advanced";
  emotionalIndicators: string[];
  keywords: string[];
  suggestedDifficulty: "beginner" | "intermediate" | "advanced";
  detectedLanguage: "hindi" | "english" | "hinglish";
  originalLanguageKeywords: string[];
}

interface EnhancedContext {
  questionAnalysis: QuestionAnalysis;
  prioritizedMetadata: {
    primaryConcepts: string[];
    relevantDefinitions: Record<string, string>;
    strategicExamples: string[];
    addressableMisconceptions: string[];
    necessaryPrerequisites: string[];
    applicableFormulas: string[];
    suggestedFigures: Array<{
      figure: string;
      purpose: string;
      educational_value: string;
    }>;
  };
  adaptiveContent: {
    coreExplanation: string;
    supportingExamples: string[];
    hands_on_activities: string[];
    difficultyLevel: string;
    cognitiveLevel: string;
  };
  responseBlueprint: {
    structure: string[];
    includeRealWorldExample: boolean;
    includeFigureReference: boolean;
    includeFollowUpQuestion: boolean;
    addressMisconceptions: boolean;
    includeActivity: boolean;
    emphasizePrerequisites: boolean;
  };
}

class RagService {
  private embeddings: number[][] = [];
  private chunks: RagChunk[] = [];
  private isLoaded = false;
  private readonly embeddingFile = "replit_embeddings_20250706_082403.json";

  // Bilingual keyword mappings
  private readonly bilingualKeywords = {
    definition: {
      english: [
        "what is",
        "define",
        "meaning of",
        "definition",
        "explain what",
      ],
      hindi: ["क्या है", "परिभाषा", "मतलब", "अर्थ", "समझाइए कि क्या"],
      hinglish: ["kya hai", "matlab kya hai", "define karo", "meaning batao"],
    },
    calculation: {
      english: [
        "how to calculate",
        "find the",
        "compute",
        "solve for",
        "determine",
        "formula",
      ],
      hindi: [
        "कैसे निकालें",
        "गणना करें",
        "हल करें",
        "निकालें",
        "सूत्र",
        "कैलकुलेट करें",
      ],
      hinglish: [
        "calculate kaise kare",
        "kaise nikalte hai",
        "solve karo",
        "formula batao",
      ],
    },
    explanation: {
      english: [
        "how does",
        "why does",
        "explain how",
        "explain why",
        "how can",
      ],
      hindi: [
        "कैसे काम करता है",
        "क्यों होता है",
        "समझाइए कैसे",
        "समझाइए क्यों",
        "कैसे हो सकता है",
      ],
      hinglish: ["kaise kaam karta hai", "kyun hota hai", "explain karo"],
    },
    examples: {
      english: ["give example", "show example", "examples of", "for instance"],
      hindi: ["उदाहरण दें", "उदाहरण दिखाएं", "मिसाल दें", "उदाहरण के लिए"],
      hinglish: ["example do", "example dikhao", "misal do"],
    },
    confusion: {
      english: [
        "don't understand",
        "confused",
        "not clear",
        "help me understand",
        "having trouble",
      ],
      hindi: [
        "समझ नहीं आ रहा",
        "कन्फ्यूज्ड हूं",
        "स्पष्ट नहीं है",
        "समझने में मदद करें",
        "परेशानी हो रही है",
      ],
      hinglish: [
        "samajh nahi aa raha",
        "confused hun",
        "clear nahi hai",
        "help karo",
      ],
    },
    application: {
      english: ["daily life", "real world", "practical", "used in", "applied"],
      hindi: [
        "दैनिक जीवन",
        "वास्तविक दुनिया",
        "व्यावहारिक",
        "उपयोग में",
        "लागू",
      ],
      hinglish: ["daily life mein", "real world mein", "practical use"],
    },
    comparison: {
      english: ["difference between", "compare", "versus", "vs", "distinguish"],
      hindi: ["अंतर", "तुलना करें", "बनाम", "फर्क", "अलग करें"],
      hinglish: ["difference kya hai", "compare karo", "fark kya hai"],
    },
    verification: {
      english: ["is it true", "correct to say", "right that", "verify"],
      hindi: ["क्या यह सच है", "कहना सही है", "सही है कि", "सत्यापित करें"],
      hinglish: ["sach hai kya", "correct hai", "right hai"],
    },
  };

  private readonly emotionalIndicators = {
    struggling: {
      english: [
        "difficult",
        "hard",
        "trouble",
        "confused",
        "don't get",
        "stuck",
      ],
      hindi: [
        "मुश्किल",
        "कठिन",
        "परेशानी",
        "कन्फ्यूज्ड",
        "समझ नहीं आ रहा",
        "अटक गया",
      ],
      hinglish: [
        "difficult hai",
        "hard hai",
        "trouble ho raha",
        "samajh nahi aa raha",
      ],
    },
    eager: {
      english: ["interesting", "want to know", "curious", "tell me more"],
      hindi: ["दिलचस्प", "जानना चाहता हूं", "उत्सुक", "और बताइए"],
      hinglish: ["interesting hai", "jaanna chahta hun", "aur batao"],
    },
    urgent: {
      english: ["exam", "test", "homework", "assignment", "need help"],
      hindi: ["परीक्षा", "टेस्ट", "होमवर्क", "असाइनमेंट", "मदद चाहिए"],
      hinglish: ["exam hai", "test aa raha", "homework hai", "help chahiye"],
    },
  };

  private readonly complexityIndicators = {
    basic: {
      english: ["simple", "basic", "easy", "understand"],
      hindi: ["सरल", "बुनियादी", "आसान", "समझना"],
      hinglish: ["simple", "basic", "easy hai", "samajhna hai"],
    },
    advanced: {
      english: ["complex", "detailed", "advanced", "in depth", "thorough"],
      hindi: ["जटिल", "विस्तृत", "उन्नत", "गहराई से", "संपूर्ण"],
      hinglish: ["complex", "detail mein", "advanced", "depth mein"],
    },
  };

  private readonly physicsKeywords = {
    english: [
      "force",
      "motion",
      "velocity",
      "acceleration",
      "mass",
      "weight",
      "friction",
      "gravity",
      "energy",
      "momentum",
      "pressure",
      "newton",
      "laws",
      "balanced",
      "unbalanced",
      "speed",
      "distance",
      "time",
      "work",
      "power",
      "density",
      "volume",
      "matter",
      "atom",
      "molecule",
      "particle",
      "push",
      "pull",
      "rest",
      "moving",
      "direction",
      "displacement",
      "uniform",
      "non-uniform",
      "contact",
      "non-contact",
      "magnetic",
      "electric",
    ],
    hindi: [
      "बल",
      "गति",
      "वेग",
      "त्वरण",
      "द्रव्यमान",
      "भार",
      "घर्षण",
      "गुरुत्वाकर्षण",
      "ऊर्जा",
      "संवेग",
      "दाब",
      "न्यूटन",
      "नियम",
      "संतुलित",
      "असंतुलित",
      "चाल",
      "दूरी",
      "समय",
      "कार्य",
      "शक्ति",
      "घनत्व",
      "आयतन",
      "पदार्थ",
      "परमाणु",
      "अणु",
      "कण",
      "धक्का",
      "खींचना",
      "विराम",
      "गतिशील",
      "दिशा",
      "विस्थापन",
      "एकसमान",
      "असमान",
      "स्पर्श",
      "अस्पर्श",
      "चुंबकीय",
      "विद्युत",
    ],
    hinglish: [
      "force",
      "motion",
      "velocity",
      "acceleration",
      "mass",
      "weight",
      "friction",
      "gravity",
      "energy",
      "momentum",
      "pressure",
      "newton",
      "laws",
      "balanced",
      "unbalanced",
      "bal",
      "gati",
      "veg",
      "tvaran",
      "drayvman",
      "bhar",
      "gharshan",
    ],
  };

  constructor() {
    this.loadEmbeddings();
  }

  private async loadEmbeddings(): Promise<void> {
    try {
      const filePath = path.join(__dirname, "../../", this.embeddingFile);

      if (!fs.existsSync(filePath)) {
        console.log(`RAG embedding file not found: ${filePath}`);
        return;
      }

      const fileContent = fs.readFileSync(filePath, "utf8");
      const data: RagEmbeddingFile = JSON.parse(fileContent);

      this.chunks = data.chunks;
      this.embeddings = data.chunks.map((chunk) => chunk.embedding);
      this.isLoaded = true;

      console.log(
        `✅ RAG embeddings loaded: ${data.chunks.length} chunks, ${data.metadata.embedding_dimension}D embeddings`,
      );

      // Log available sections and types for debugging
      const sections = [...new Set(this.chunks.map((c) => c.section))];
      const types = [...new Set(this.chunks.map((c) => c.type))];
      console.log(`📚 Available sections: ${sections.join(", ")}`);
      console.log(`📑 Available types: ${types.join(", ")}`);
    } catch (error) {
      console.error("❌ Failed to load RAG embeddings:", error);
      this.isLoaded = false;
    }
  }

  public isRagAvailable(): boolean {
    return this.isLoaded && this.chunks.length > 0;
  }

  public getStats(): { totalChunks: number; isLoaded: boolean } {
    return {
      totalChunks: this.chunks.length,
      isLoaded: this.isLoaded,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Detect the primary language of the question
   */
  private detectLanguage(question: string): "hindi" | "english" | "hinglish" {
    const lowerQuestion = question.toLowerCase();

    // Check for Devanagari script (Hindi)
    const hindiScriptRegex = /[\u0900-\u097F]/;
    const hasHindiScript = hindiScriptRegex.test(question);

    // Count English vs Hindi keywords
    let englishScore = 0;
    let hindiScore = 0;
    let hinglishScore = 0;

    // Check all keyword categories
    Object.values(this.bilingualKeywords).forEach((category) => {
      category.english.forEach((keyword) => {
        if (lowerQuestion.includes(keyword)) englishScore++;
      });
      category.hindi.forEach((keyword) => {
        if (lowerQuestion.includes(keyword)) hindiScore++;
      });
      category.hinglish.forEach((keyword) => {
        if (lowerQuestion.includes(keyword)) hinglishScore++;
      });
    });

    // Check physics keywords
    this.physicsKeywords.english.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) englishScore++;
    });
    this.physicsKeywords.hindi.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) hindiScore++;
    });
    this.physicsKeywords.hinglish.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) hinglishScore++;
    });

    // Determine language based on script and keyword scores
    if (hasHindiScript && hindiScore > englishScore) {
      return "hindi";
    } else if (hinglishScore > 0 || (hasHindiScript && englishScore > 0)) {
      return "hinglish";
    } else if (englishScore > hindiScore) {
      return "english";
    } else if (hasHindiScript) {
      return "hindi";
    } else {
      return "english"; // Default fallback
    }
  }

  /**
   * Check if question contains keywords from a specific category across all languages
   */
  private matchesKeywordCategory(
    question: string,
    category: any,
  ): { matches: boolean; language: string; matchedKeywords: string[] } {
    const lowerQuestion = question.toLowerCase();
    const matchedKeywords: string[] = [];
    let detectedLanguage = "";

    // Check English keywords
    const englishMatches = category.english.filter((keyword: string) => {
      if (lowerQuestion.includes(keyword)) {
        matchedKeywords.push(keyword);
        return true;
      }
      return false;
    });

    // Check Hindi keywords
    const hindiMatches = category.hindi.filter((keyword: string) => {
      if (lowerQuestion.includes(keyword)) {
        matchedKeywords.push(keyword);
        return true;
      }
      return false;
    });

    // Check Hinglish keywords
    const hinglishMatches = category.hinglish.filter((keyword: string) => {
      if (lowerQuestion.includes(keyword)) {
        matchedKeywords.push(keyword);
        return true;
      }
      return false;
    });

    // Determine which language had matches
    if (hindiMatches.length > 0) {
      detectedLanguage = "hindi";
    } else if (hinglishMatches.length > 0) {
      detectedLanguage = "hinglish";
    } else if (englishMatches.length > 0) {
      detectedLanguage = "english";
    }

    return {
      matches: matchedKeywords.length > 0,
      language: detectedLanguage,
      matchedKeywords,
    };
  }

  /**
   * Enhanced bilingual question analysis
   */
  private analyzeQuestion(question: string): QuestionAnalysis {
    const lowerQuestion = question.toLowerCase();
    const detectedLanguage = this.detectLanguage(question);

    console.log(
      `🔍 LANGUAGE DETECTION: Detected language: ${detectedLanguage}`,
    );

    // Determine question type and intent using bilingual keywords
    let type: QuestionAnalysis["type"] = "conceptual";
    let intent: QuestionAnalysis["intent"] = "explanation";
    const originalLanguageKeywords: string[] = [];

    // Check each intent category
    const definitionMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.definition,
    );
    const calculationMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.calculation,
    );
    const examplesMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.examples,
    );
    const confusionMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.confusion,
    );
    const applicationMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.application,
    );
    const comparisonMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.comparison,
    );
    const verificationMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.bilingualKeywords.verification,
    );

    // Determine type and intent based on matches
    if (definitionMatch.matches) {
      type = "conceptual";
      intent = "definition";
      originalLanguageKeywords.push(...definitionMatch.matchedKeywords);
    } else if (calculationMatch.matches) {
      type = "procedural";
      intent = "calculation";
      originalLanguageKeywords.push(...calculationMatch.matchedKeywords);
    } else if (examplesMatch.matches) {
      type = "example_seeking";
      intent = "examples";
      originalLanguageKeywords.push(...examplesMatch.matchedKeywords);
    } else if (confusionMatch.matches) {
      type = "troubleshooting";
      intent = "confusion";
      originalLanguageKeywords.push(...confusionMatch.matchedKeywords);
    } else if (applicationMatch.matches) {
      type = "application";
      intent = "application";
      originalLanguageKeywords.push(...applicationMatch.matchedKeywords);
    } else if (comparisonMatch.matches) {
      type = "comparison";
      intent = "explanation";
      originalLanguageKeywords.push(...comparisonMatch.matchedKeywords);
    } else if (verificationMatch.matches) {
      intent = "verification";
      originalLanguageKeywords.push(...verificationMatch.matchedKeywords);
    }

    // Determine complexity using bilingual indicators
    let complexity: QuestionAnalysis["complexity"] = "intermediate";
    const basicMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.complexityIndicators.basic,
    );
    const advancedMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.complexityIndicators.advanced,
    );

    if (basicMatch.matches) {
      complexity = "basic";
      originalLanguageKeywords.push(...basicMatch.matchedKeywords);
    } else if (advancedMatch.matches) {
      complexity = "advanced";
      originalLanguageKeywords.push(...advancedMatch.matchedKeywords);
    }

    // Extract emotional indicators using bilingual detection
    const emotionalIndicators: string[] = [];

    const strugglingMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.emotionalIndicators.struggling,
    );
    const eagerMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.emotionalIndicators.eager,
    );
    const urgentMatch = this.matchesKeywordCategory(
      lowerQuestion,
      this.emotionalIndicators.urgent,
    );

    if (strugglingMatch.matches) {
      emotionalIndicators.push("struggling");
      originalLanguageKeywords.push(...strugglingMatch.matchedKeywords);
    }
    if (eagerMatch.matches) {
      emotionalIndicators.push("eager");
      originalLanguageKeywords.push(...eagerMatch.matchedKeywords);
    }
    if (urgentMatch.matches) {
      emotionalIndicators.push("urgent");
      originalLanguageKeywords.push(...urgentMatch.matchedKeywords);
    }

    // Extract physics-related keywords from all languages
    const keywords: string[] = [];

    // Check English physics keywords
    this.physicsKeywords.english.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) {
        keywords.push(keyword);
      }
    });

    // Check Hindi physics keywords
    this.physicsKeywords.hindi.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) {
        keywords.push(keyword);
        originalLanguageKeywords.push(keyword);
      }
    });

    // Check Hinglish physics keywords
    this.physicsKeywords.hinglish.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) {
        keywords.push(keyword);
        originalLanguageKeywords.push(keyword);
      }
    });

    // Suggest difficulty level based on question complexity and emotional indicators
    let suggestedDifficulty: "beginner" | "intermediate" | "advanced" =
      "intermediate";
    if (complexity === "basic" || emotionalIndicators.includes("struggling")) {
      suggestedDifficulty = "beginner";
    } else if (
      complexity === "advanced" &&
      !emotionalIndicators.includes("struggling")
    ) {
      suggestedDifficulty = "advanced";
    }

    console.log(
      `🔍 QUESTION ANALYSIS: Type: ${type}, Intent: ${intent}, Language: ${detectedLanguage}`,
    );
    console.log(`🔍 MATCHED KEYWORDS: ${originalLanguageKeywords.join(", ")}`);

    return {
      type,
      intent,
      complexity,
      emotionalIndicators,
      keywords,
      suggestedDifficulty,
      detectedLanguage,
      originalLanguageKeywords,
    };
  }

  /**
   * Calculate metadata relevance score for a chunk based on question analysis
   */
  private calculateMetadataRelevance(
    chunk: RagChunk,
    questionAnalysis: QuestionAnalysis,
  ): number {
    let relevanceScore = 0;
    const metadata = chunk.ai_metadata;

    // Difficulty level alignment (important for struggling students)
    if (metadata.difficulty_level) {
      if (
        questionAnalysis.emotionalIndicators.includes("struggling") &&
        metadata.difficulty_level === "beginner"
      ) {
        relevanceScore += 0.3;
      } else if (
        questionAnalysis.suggestedDifficulty === metadata.difficulty_level
      ) {
        relevanceScore += 0.2;
      }
    }

    // Content type alignment with question intent
    if (questionAnalysis.intent === "examples" && chunk.type === "example") {
      relevanceScore += 0.4;
    } else if (
      questionAnalysis.intent === "application" &&
      (metadata.real_world_examples?.length || 0) > 0
    ) {
      relevanceScore += 0.3;
    } else if (
      questionAnalysis.intent === "definition" &&
      (metadata.key_definitions || metadata.main_concepts)
    ) {
      relevanceScore += 0.3;
    } else if (
      questionAnalysis.intent === "calculation" &&
      (metadata.key_formulas?.length || 0) > 0
    ) {
      relevanceScore += 0.4;
    } else if (
      questionAnalysis.intent === "confusion" &&
      (metadata.common_misconceptions?.length || 0) > 0
    ) {
      relevanceScore += 0.4;
    }

    // Figure availability for visual learners (especially for confusion cases)
    if (
      metadata.figure_analysis?.length &&
      (questionAnalysis.emotionalIndicators.includes("struggling") ||
        questionAnalysis.intent === "explanation")
    ) {
      relevanceScore += 0.2;
    }

    // Activity availability for hands-on learners
    if (
      chunk.type === "activity" &&
      (questionAnalysis.type === "application" ||
        questionAnalysis.emotionalIndicators.includes("eager"))
    ) {
      relevanceScore += 0.2;
    }

    // Prerequisites alignment for confused students
    if (
      questionAnalysis.emotionalIndicators.includes("struggling") &&
      (metadata.prerequisites?.length || 0) > 0
    ) {
      relevanceScore += 0.1;
    }

    // Language preference boost - if Hindi/Hinglish detected, slightly boost activity chunks
    if (
      (questionAnalysis.detectedLanguage === "hindi" ||
        questionAnalysis.detectedLanguage === "hinglish") &&
      chunk.type === "activity"
    ) {
      relevanceScore += 0.1; // Activities often work well for non-English speakers
    }

    return Math.min(relevanceScore, 1.0); // Cap at 1.0
  }

  public async findSimilarChunks(
    queryEmbedding: number[],
    questionAnalysis: QuestionAnalysis,
    options: {
      topK?: number;
      minSimilarity?: number;
      chapterFilter?: string;
      typeFilter?: string[];
      difficultyFilter?: string[];
    } = {},
  ): Promise<SimilarityResult[]> {
    if (!this.isRagAvailable()) {
      throw new Error("RAG embeddings not available");
    }

    const {
      topK = 5,
      minSimilarity = 0.1,
      chapterFilter = "8",
      typeFilter = [],
      difficultyFilter = [],
    } = options;

    console.log(
      `🔍 RAG SEARCH: Query analysis - Type: ${questionAnalysis.type}, Intent: ${questionAnalysis.intent}, Language: ${questionAnalysis.detectedLanguage}`,
    );

    // Calculate similarities with metadata relevance boost
    const similarities: SimilarityResult[] = [];
    let filteredCount = 0;

    for (let i = 0; i < this.embeddings.length; i++) {
      const chunk = this.chunks[i];

      // Apply filters
      if (chapterFilter && !chunk.section.startsWith(chapterFilter)) {
        continue;
      }

      if (typeFilter.length > 0 && !typeFilter.includes(chunk.type)) {
        continue;
      }

      if (
        difficultyFilter.length > 0 &&
        chunk.ai_metadata.difficulty_level &&
        !difficultyFilter.includes(chunk.ai_metadata.difficulty_level)
      ) {
        continue;
      }

      filteredCount++;
      const similarity = this.cosineSimilarity(
        queryEmbedding,
        this.embeddings[i],
      );
      const metadataRelevance = this.calculateMetadataRelevance(
        chunk,
        questionAnalysis,
      );

      // Combine similarity with metadata relevance (weighted)
      const combinedScore = similarity * 0.7 + metadataRelevance * 0.3;

      if (combinedScore >= minSimilarity) {
        similarities.push({
          chunk,
          similarity,
          metadataRelevanceScore: metadataRelevance,
        });
      }
    }

    console.log(
      `🔍 RAG SEARCH: Found ${similarities.length} relevant chunks with metadata boost`,
    );

    // Sort by combined score and return top K
    return similarities
      .sort((a, b) => {
        const scoreA = a.similarity * 0.7 + a.metadataRelevanceScore * 0.3;
        const scoreB = b.similarity * 0.7 + b.metadataRelevanceScore * 0.3;
        return scoreB - scoreA;
      })
      .slice(0, topK);
  }

  /**
   * Generate response blueprint based on question analysis and available metadata
   */
  private generateResponseBlueprint(
    questionAnalysis: QuestionAnalysis,
    availableMetadata: any,
  ): EnhancedContext["responseBlueprint"] {
    const blueprint: EnhancedContext["responseBlueprint"] = {
      structure: [],
      includeRealWorldExample: false,
      includeFigureReference: false,
      includeFollowUpQuestion: false,
      addressMisconceptions: false,
      includeActivity: false,
      emphasizePrerequisites: false,
    };

    // Language-aware adjustments
    const isHindiOrHinglish =
      questionAnalysis.detectedLanguage === "hindi" ||
      questionAnalysis.detectedLanguage === "hinglish";

    // Base structure based on question type
    if (
      questionAnalysis.type === "conceptual" &&
      questionAnalysis.intent === "definition"
    ) {
      blueprint.structure = [
        "clear_definition",
        "key_characteristics",
        "real_world_connection",
        "common_misconceptions",
      ];
      blueprint.includeRealWorldExample = Math.random() < 0.4; // 40% chance
      blueprint.includeFigureReference = Math.random() < 0.3; // 30% chance
    } else if (questionAnalysis.type === "procedural") {
      blueprint.structure = [
        "identify_what_to_find",
        "list_given_information",
        "apply_formula_step_by_step",
        "verify_answer",
        "common_mistakes",
      ];
      blueprint.includeFigureReference = Math.random() < 0.4; // Higher for procedural
      blueprint.includeFollowUpQuestion = Math.random() < 0.3;
    } else if (questionAnalysis.type === "troubleshooting") {
      blueprint.structure = [
        "acknowledge_difficulty",
        "address_misconceptions",
        "break_down_concept",
        "provide_analogy",
        "suggest_practice",
      ];
      blueprint.addressMisconceptions = true;
      blueprint.emphasizePrerequisites = true;
      blueprint.includeActivity = Math.random() < 0.5; // 50% chance for hands-on help
    } else if (questionAnalysis.type === "application") {
      blueprint.structure = [
        "connect_to_real_world",
        "explain_physics_principles",
        "demonstrate_application",
        "suggest_observation",
      ];
      blueprint.includeRealWorldExample = true; // Always for application questions
      blueprint.includeActivity = Math.random() < 0.6; // 60% chance
    } else if (questionAnalysis.type === "example_seeking") {
      blueprint.structure = [
        "provide_concrete_example",
        "explain_underlying_concept",
        "show_variations",
        "encourage_exploration",
      ];
      blueprint.includeRealWorldExample = true;
      blueprint.includeActivity = Math.random() < 0.4;
    }

    // Language-specific adjustments
    if (isHindiOrHinglish) {
      // Hindi/Hinglish speakers often benefit more from visual and hands-on approaches
      blueprint.includeActivity =
        blueprint.includeActivity || Math.random() < 0.3; // Boost activity inclusion
      blueprint.includeFigureReference =
        blueprint.includeFigureReference || Math.random() < 0.2; // Boost figure reference
      blueprint.includeRealWorldExample =
        blueprint.includeRealWorldExample || Math.random() < 0.3; // Boost real-world examples
    }

    // Adjust based on emotional indicators
    if (questionAnalysis.emotionalIndicators.includes("struggling")) {
      blueprint.emphasizePrerequisites = true;
      blueprint.addressMisconceptions = true;
      blueprint.includeActivity = Math.random() < 0.7; // Higher chance for hands-on help

      // Extra support for Hindi/Hinglish struggling students
      if (isHindiOrHinglish) {
        blueprint.includeActivity = Math.random() < 0.8; // Even higher chance
        blueprint.includeRealWorldExample = true; // Always include for struggling Hindi speakers
      }
    }

    if (questionAnalysis.emotionalIndicators.includes("eager")) {
      blueprint.includeFollowUpQuestion = Math.random() < 0.6; // Higher chance for curious students
      blueprint.structure.push("explore_further");
    }

    // Metadata availability adjustments
    if (
      availableMetadata.hasRealWorldExamples &&
      !blueprint.includeRealWorldExample
    ) {
      blueprint.includeRealWorldExample = Math.random() < 0.3; // Give it a chance
    }

    if (availableMetadata.hasFigures && !blueprint.includeFigureReference) {
      blueprint.includeFigureReference = Math.random() < 0.25;
    }

    if (
      availableMetadata.hasMisconceptions &&
      !blueprint.addressMisconceptions
    ) {
      blueprint.addressMisconceptions = Math.random() < 0.4;
    }

    return blueprint;
  }

  /**
   * Assemble enhanced context with question-centric metadata selection
   */
  public assembleEnhancedContext(
    questionAnalysis: QuestionAnalysis,
    similarChunks: SimilarityResult[],
  ): EnhancedContext {
    if (similarChunks.length === 0) {
      return {
        questionAnalysis,
        prioritizedMetadata: {
          primaryConcepts: [],
          relevantDefinitions: {},
          strategicExamples: [],
          addressableMisconceptions: [],
          necessaryPrerequisites: [],
          applicableFormulas: [],
          suggestedFigures: [],
        },
        adaptiveContent: {
          coreExplanation: "",
          supportingExamples: [],
          hands_on_activities: [],
          difficultyLevel: "beginner",
          cognitiveLevel: "understand",
        },
        responseBlueprint: {
          structure: ["simple_explanation"],
          includeRealWorldExample: false,
          includeFigureReference: false,
          includeFollowUpQuestion: false,
          addressMisconceptions: false,
          includeActivity: false,
          emphasizePrerequisites: false,
        },
      };
    }

    // Analyze available metadata
    const allMetadata = similarChunks.map((s) => s.chunk.ai_metadata);
    const availableMetadata = {
      hasRealWorldExamples: allMetadata.some(
        (m) => (m.real_world_examples?.length || 0) > 0,
      ),
      hasFigures: allMetadata.some((m) => (m.figure_analysis?.length || 0) > 0),
      hasMisconceptions: allMetadata.some(
        (m) => (m.common_misconceptions?.length || 0) > 0,
      ),
      hasFormulas: allMetadata.some((m) => (m.key_formulas?.length || 0) > 0),
      hasActivities: similarChunks.some((s) => s.chunk.type === "activity"),
    };

    // Generate response blueprint
    const responseBlueprint = this.generateResponseBlueprint(
      questionAnalysis,
      availableMetadata,
    );

    // Extract prioritized metadata based on question intent
    const prioritizedMetadata = this.extractPrioritizedMetadata(
      questionAnalysis,
      allMetadata,
      responseBlueprint,
    );

    // Assemble adaptive content
    const adaptiveContent = this.assembleAdaptiveContent(
      questionAnalysis,
      similarChunks,
      responseBlueprint,
    );

    return {
      questionAnalysis,
      prioritizedMetadata,
      adaptiveContent,
      responseBlueprint,
    };
  }

  private extractPrioritizedMetadata(
    questionAnalysis: QuestionAnalysis,
    allMetadata: any[],
    blueprint: EnhancedContext["responseBlueprint"],
  ): EnhancedContext["prioritizedMetadata"] {
    // Extract main concepts with preference for question-relevant ones
    const primaryConcepts: string[] = [];
    allMetadata.forEach((meta) => {
      if (Array.isArray(meta.main_concepts)) {
        meta.main_concepts.forEach((concept: any) => {
          const conceptName =
            typeof concept === "object" ? concept.concept : concept;
          if (
            conceptName &&
            questionAnalysis.keywords.some((k) =>
              conceptName.toLowerCase().includes(k),
            )
          ) {
            primaryConcepts.unshift(conceptName); // Priority to question-relevant concepts
          } else if (conceptName) {
            primaryConcepts.push(conceptName);
          }
        });
      }
      if (meta.concepts) primaryConcepts.push(...meta.concepts);
      if (meta.concepts_demonstrated)
        primaryConcepts.push(...meta.concepts_demonstrated);
    });

    // Extract definitions with priority for question keywords
    const relevantDefinitions: Record<string, string> = {};
    allMetadata.forEach((meta) => {
      if (meta.key_definitions) {
        Object.entries(meta.key_definitions).forEach(([term, def]) => {
          if (
            questionAnalysis.keywords.some((k) =>
              term.toLowerCase().includes(k),
            )
          ) {
            relevantDefinitions[term] = def as string;
          }
        });
      }
    });

    // Strategic examples based on question type
    const strategicExamples: string[] = [];
    if (
      questionAnalysis.type === "application" ||
      blueprint.includeRealWorldExample
    ) {
      allMetadata.forEach((meta) => {
        if (meta.real_world_examples)
          strategicExamples.push(...meta.real_world_examples);
        if (meta.real_world_connections)
          strategicExamples.push(...meta.real_world_connections);
      });
    }

    // Addressable misconceptions (especially for confusion/troubleshooting)
    const addressableMisconceptions: string[] = [];
    if (
      questionAnalysis.type === "troubleshooting" ||
      blueprint.addressMisconceptions
    ) {
      allMetadata.forEach((meta) => {
        if (meta.common_misconceptions)
          addressableMisconceptions.push(...meta.common_misconceptions);
        if (meta.misconceptions_addressed)
          addressableMisconceptions.push(...meta.misconceptions_addressed);
      });
    }

    // Prerequisites for struggling students
    const necessaryPrerequisites: string[] = [];
    if (
      questionAnalysis.emotionalIndicators.includes("struggling") ||
      blueprint.emphasizePrerequisites
    ) {
      allMetadata.forEach((meta) => {
        if (meta.prerequisites)
          necessaryPrerequisites.push(...meta.prerequisites);
        if (meta.prerequisite_knowledge)
          necessaryPrerequisites.push(...meta.prerequisite_knowledge);
      });
    }

    // Formulas for calculation questions
    const applicableFormulas: string[] = [];
    if (
      questionAnalysis.intent === "calculation" ||
      questionAnalysis.type === "procedural"
    ) {
      allMetadata.forEach((meta) => {
        if (meta.key_formulas) applicableFormulas.push(...meta.key_formulas);
      });
    }

    // Figures for visual support
    const suggestedFigures: Array<{
      figure: string;
      purpose: string;
      educational_value: string;
    }> = [];
    if (blueprint.includeFigureReference) {
      allMetadata.forEach((meta) => {
        if (meta.figure_analysis) {
          suggestedFigures.push(
            ...meta.figure_analysis.filter(
              (fig: any) =>
                fig.educational_value === "high" ||
                questionAnalysis.emotionalIndicators.includes("struggling"),
            ),
          );
        }
      });
    }

    return {
      primaryConcepts: [...new Set(primaryConcepts)].slice(0, 5),
      relevantDefinitions,
      strategicExamples: [...new Set(strategicExamples)].slice(0, 3),
      addressableMisconceptions: [...new Set(addressableMisconceptions)].slice(
        0,
        3,
      ),
      necessaryPrerequisites: [...new Set(necessaryPrerequisites)].slice(0, 3),
      applicableFormulas: [...new Set(applicableFormulas)].slice(0, 3),
      suggestedFigures: suggestedFigures.slice(0, 2),
    };
  }

  private assembleAdaptiveContent(
    questionAnalysis: QuestionAnalysis,
    similarChunks: SimilarityResult[],
    blueprint: EnhancedContext["responseBlueprint"],
  ): EnhancedContext["adaptiveContent"] {
    // Select core content based on question type and similarity
    const contentChunks = similarChunks
      .filter((s) => s.chunk.type === "content")
      .slice(0, 2);
    const exampleChunks = similarChunks
      .filter((s) => s.chunk.type === "example")
      .slice(0, 2);
    const activityChunks = similarChunks
      .filter((s) => s.chunk.type === "activity")
      .slice(0, 1);

    const contentParts: string[] = [];

    // Core explanation - use prepared_text for enhanced metadata
    if (contentChunks.length > 0) {
      contentParts.push(
        `CORE CONCEPT:\n${contentChunks[0].chunk.prepared_text || contentChunks[0].chunk.content}`,
      );
    }

    // Supporting examples based on question needs
    const supportingExamples: string[] = [];
    if (
      questionAnalysis.intent === "examples" ||
      blueprint.includeRealWorldExample
    ) {
      exampleChunks.forEach((result) => {
        supportingExamples.push(result.chunk.content);
      });
    }

    // Activities for hands-on learning
    const hands_on_activities: string[] = [];
    if (blueprint.includeActivity && activityChunks.length > 0) {
      activityChunks.forEach((result) => {
        hands_on_activities.push(result.chunk.content);
      });
    }

    // Determine appropriate difficulty and cognitive level
    const difficulties = similarChunks
      .map((s) => s.chunk.ai_metadata.difficulty_level)
      .filter(Boolean);

    let difficultyLevel = questionAnalysis.suggestedDifficulty;
    if (difficulties.length > 0) {
      // Use the most appropriate difficulty from chunks
      difficultyLevel = difficulties[0] || difficultyLevel;
    }

    const cognitiveLevels = similarChunks
      .map((s) => s.chunk.ai_metadata.cognitive_level)
      .filter(Boolean);

    const cognitiveLevel = cognitiveLevels[0] || "understand";

    return {
      coreExplanation: contentParts.join("\n\n"),
      supportingExamples,
      hands_on_activities,
      difficultyLevel,
      cognitiveLevel,
    };
  }

  /**
   * Create enhanced educational prompt with adaptive structure and language awareness
   */
  public createEnhancedEducationalPrompt(
    question: string,
    enhancedContext: EnhancedContext,
    language: string = "auto",
  ): string {
    // Auto-detect language if not specified
    let responseLanguage = language;
    if (language === "auto") {
      responseLanguage = enhancedContext.questionAnalysis.detectedLanguage;
    }

    const languageInstructions = {
      hindi:
        "हिंदी में स्पष्ट और सरल भाषा में जवाब दें। तकनीकी शब्दों के साथ उनका हिंदी अर्थ भी दें।",
      english:
        "Respond in clear, simple English appropriate for Grade 9 students.",
      hinglish:
        "Respond in Hinglish (Hindi-English mix) - use whichever language feels more natural for each concept. Technical terms can be in English with Hindi explanations.",
    };

    const instruction =
      languageInstructions[
        responseLanguage as keyof typeof languageInstructions
      ] || languageInstructions.english;

    let prompt = `You are Ravi Bhaiya, an expert NCERT Grade 9 Physics tutor. The student has asked a ${enhancedContext.questionAnalysis.type} question in ${enhancedContext.questionAnalysis.detectedLanguage} with ${enhancedContext.questionAnalysis.intent} intent.

STUDENT QUESTION: ${question}

QUESTION ANALYSIS:
- Type: ${enhancedContext.questionAnalysis.type}
- Intent: ${enhancedContext.questionAnalysis.intent} 
- Complexity: ${enhancedContext.questionAnalysis.complexity}
- Detected Language: ${enhancedContext.questionAnalysis.detectedLanguage}
- Student seems: ${enhancedContext.questionAnalysis.emotionalIndicators.join(", ") || "engaged"}
- Original keywords found: ${enhancedContext.questionAnalysis.originalLanguageKeywords.join(", ")}

RELEVANT NCERT CONTENT:
${enhancedContext.adaptiveContent.coreExplanation}
`;

    // Add prioritized metadata contextually
    if (enhancedContext.prioritizedMetadata.primaryConcepts.length > 0) {
      prompt += `
KEY PHYSICS CONCEPTS TO ADDRESS:
${enhancedContext.prioritizedMetadata.primaryConcepts.map((concept) => `• ${concept}`).join("\n")}
`;
    }

    if (
      Object.keys(enhancedContext.prioritizedMetadata.relevantDefinitions)
        .length > 0
    ) {
      prompt += `
IMPORTANT DEFINITIONS:
${Object.entries(enhancedContext.prioritizedMetadata.relevantDefinitions)
  .map(([term, def]) => `• ${term}: ${def}`)
  .join("\n")}
`;
    }

    // Add strategic examples if relevant
    if (
      enhancedContext.prioritizedMetadata.strategicExamples.length > 0 &&
      enhancedContext.responseBlueprint.includeRealWorldExample
    ) {
      prompt += `
REAL-WORLD CONNECTIONS TO USE:
${enhancedContext.prioritizedMetadata.strategicExamples.map((example) => `• ${example}`).join("\n")}
`;
    }

    // Add misconceptions to address if relevant
    if (
      enhancedContext.prioritizedMetadata.addressableMisconceptions.length >
        0 &&
      enhancedContext.responseBlueprint.addressMisconceptions
    ) {
      prompt += `
⚠️ IMPORTANT: Address these common misconceptions:
${enhancedContext.prioritizedMetadata.addressableMisconceptions.map((misc) => `• ${misc}`).join("\n")}
`;
    }

    // Add prerequisites if student seems to be struggling
    if (
      enhancedContext.prioritizedMetadata.necessaryPrerequisites.length > 0 &&
      enhancedContext.responseBlueprint.emphasizePrerequisites
    ) {
      prompt += `
PREREQUISITES TO CHECK/REVIEW:
${enhancedContext.prioritizedMetadata.necessaryPrerequisites.map((prereq) => `• ${prereq}`).join("\n")}
`;
    }

    // Add formulas for calculation questions
    if (
      enhancedContext.prioritizedMetadata.applicableFormulas.length > 0 &&
      enhancedContext.questionAnalysis.intent === "calculation"
    ) {
      prompt += `
RELEVANT FORMULAS:
${enhancedContext.prioritizedMetadata.applicableFormulas.map((formula) => `• ${formula}`).join("\n")}
`;
    }

    // Add figure references if applicable
    if (
      enhancedContext.prioritizedMetadata.suggestedFigures.length > 0 &&
      enhancedContext.responseBlueprint.includeFigureReference
    ) {
      prompt += `
TEXTBOOK FIGURES TO REFERENCE:
${enhancedContext.prioritizedMetadata.suggestedFigures
  .map(
    (fig) =>
      `• Figure ${fig.figure}: ${fig.purpose} (${fig.educational_value} educational value)`,
  )
  .join("\n")}
`;
    }

    // Add supporting examples if available
    if (enhancedContext.adaptiveContent.supportingExamples.length > 0) {
      prompt += `
WORKED EXAMPLES AVAILABLE:
${enhancedContext.adaptiveContent.supportingExamples
  .map((example, i) => `Example ${i + 1}: ${example.slice(0, 150)}...`)
  .join("\n")}
`;
    }

    // Add activities for hands-on learning
    if (
      enhancedContext.adaptiveContent.hands_on_activities.length > 0 &&
      enhancedContext.responseBlueprint.includeActivity
    ) {
      prompt += `
HANDS-ON ACTIVITY TO SUGGEST:
${enhancedContext.adaptiveContent.hands_on_activities
  .map((activity) => activity.slice(0, 200) + "...")
  .join("\n")}
`;
    }

    // Question-type specific response structure
    prompt += `
RESPONSE STRUCTURE FOR ${enhancedContext.questionAnalysis.type.toUpperCase()} QUESTION:
`;

    if (
      enhancedContext.questionAnalysis.type === "conceptual" &&
      enhancedContext.questionAnalysis.intent === "definition"
    ) {
      prompt += `1. Start with a clear, simple definition using the provided definitions
2. Explain key characteristics using the main concepts
3. ${enhancedContext.responseBlueprint.includeRealWorldExample ? "Connect to real-world examples provided" : "Give a simple analogy"}
4. ${enhancedContext.responseBlueprint.addressMisconceptions ? "Address the common misconceptions listed" : "Reinforce the key points"}
5. ${enhancedContext.responseBlueprint.includeFollowUpQuestion ? "End with a follow-up question to test understanding" : "Summarize the main concept"}`;
    } else if (enhancedContext.questionAnalysis.type === "procedural") {
      prompt += `1. Identify what needs to be found from the question
2. List the given information clearly
3. Show the relevant formula from those provided
4. Work through the solution step-by-step
5. ${enhancedContext.responseBlueprint.includeFigureReference ? "Reference the suggested figure if helpful for visualization" : "Verify the answer makes sense"}
6. Warn about common calculation mistakes`;
    } else if (enhancedContext.questionAnalysis.type === "troubleshooting") {
      prompt += `1. Acknowledge the difficulty warmly and reassure the student
2. ${enhancedContext.responseBlueprint.emphasizePrerequisites ? "First check if they understand the prerequisites listed" : "Identify the specific confusion"}
3. ${enhancedContext.responseBlueprint.addressMisconceptions ? "Directly address the relevant misconceptions from the list" : "Break down the concept into simpler parts"}
4. Provide a clear, step-by-step explanation using simpler language
5. ${enhancedContext.responseBlueprint.includeActivity ? "Suggest the hands-on activity to make it concrete" : "Give a helpful analogy"}
6. Encourage them and suggest next steps`;
    } else if (enhancedContext.questionAnalysis.type === "application") {
      prompt += `1. Start by connecting the physics concept to the real-world context
2. Use the real-world examples provided to illustrate the connection
3. Explain how the physics principles apply in this context
4. ${enhancedContext.responseBlueprint.includeActivity ? "Suggest the related activity for hands-on exploration" : "Give additional examples they can observe"}
5. ${enhancedContext.responseBlueprint.includeFollowUpQuestion ? "Ask them to think of other applications" : "Summarize the key applications"}`;
    } else if (enhancedContext.questionAnalysis.type === "example_seeking") {
      prompt += `1. Provide concrete examples using the real-world connections
2. For each example, clearly explain the underlying physics concept
3. Show how the concept manifests differently in various situations
4. ${enhancedContext.responseBlueprint.includeActivity ? "Suggest the activity for them to explore more examples" : "Encourage them to look for more examples around them"}`;
    } else if (enhancedContext.questionAnalysis.type === "comparison") {
      prompt += `1. Clearly state what is being compared
2. Explain each concept/phenomenon separately first
3. Then highlight the key similarities and differences
4. Use examples to illustrate the differences
5. ${enhancedContext.responseBlueprint.includeFollowUpQuestion ? "Ask a question to test their understanding of the differences" : "Summarize the main distinctions"}`;
    }

    // Adaptive teaching guidelines based on student indicators
    prompt += `

ADAPTIVE TEACHING GUIDELINES:
- Target Level: ${enhancedContext.adaptiveContent.difficultyLevel} difficulty for Grade 9 students
- Cognitive Approach: ${enhancedContext.adaptiveContent.cognitiveLevel} level explanations
- Response Language: ${responseLanguage}`;

    // Language-specific guidance
    if (responseLanguage === "hindi") {
      prompt += `
- HINDI RESPONSE GUIDELINES:
  * Use simple, clear Hindi with Devanagari script
  * For technical physics terms, provide both English and Hindi equivalents
  * Use familiar analogies from Indian context
  * Keep sentences shorter and simpler`;
    } else if (responseLanguage === "hinglish") {
      prompt += `
- HINGLISH RESPONSE GUIDELINES:
  * Mix Hindi and English naturally - use whichever feels more appropriate for each concept
  * Technical terms can be in English, explanations in Hindi
  * Use familiar expressions in both languages
  * Write numbers and formulas in English script`;
    }

    if (
      enhancedContext.questionAnalysis.emotionalIndicators.includes(
        "struggling",
      )
    ) {
      prompt += `
- EXTRA SUPPORT NEEDED: Student seems to be struggling
  * Use even simpler language and shorter sentences
  * Break explanations into smaller steps
  * Be extra encouraging and patient in tone
  * Focus on building confidence`;

      if (responseLanguage === "hindi" || responseLanguage === "hinglish") {
        prompt += `
  * Use more familiar, everyday examples from Indian context
  * Consider explaining concepts through practical situations they encounter daily`;
      }
    }

    if (
      enhancedContext.questionAnalysis.emotionalIndicators.includes("eager")
    ) {
      prompt += `
- ENGAGEMENT OPPORTUNITY: Student seems curious and eager
  * Provide slightly more detail and connections
  * Include interesting extensions or applications
  * Encourage exploration and deeper thinking`;
    }

    if (
      enhancedContext.questionAnalysis.emotionalIndicators.includes("urgent")
    ) {
      prompt += `
- TIME-SENSITIVE: Student seems to need quick help (exam/homework)
  * Be concise but complete
  * Focus on the most important points
  * Provide clear, actionable guidance`;
    }

    // Figure reference instructions
    if (
      enhancedContext.responseBlueprint.includeFigureReference &&
      enhancedContext.prioritizedMetadata.suggestedFigures.length > 0
    ) {
      const figureRef =
        responseLanguage === "hindi"
          ? `चित्र ${enhancedContext.prioritizedMetadata.suggestedFigures[0].figure} को देखिए जो ${enhancedContext.prioritizedMetadata.suggestedFigures[0].purpose} दिखाता है`
          : responseLanguage === "hinglish"
            ? `Figure ${enhancedContext.prioritizedMetadata.suggestedFigures[0].figure} dekho jo ${enhancedContext.prioritizedMetadata.suggestedFigures[0].purpose} dikhata hai`
            : `Looking at Figure ${enhancedContext.prioritizedMetadata.suggestedFigures[0].figure} in your textbook, you can see how ${enhancedContext.prioritizedMetadata.suggestedFigures[0].purpose}`;

      prompt += `
- FIGURE REFERENCE: Include a reference like "${figureRef}..."`;
    }

    // Follow-up question instructions
    if (enhancedContext.responseBlueprint.includeFollowUpQuestion) {
      prompt += `
- FOLLOW-UP QUESTION: End with a thoughtful question in the same language that tests their understanding and encourages them to apply what they've learned`;
    }

    prompt += `

RESPONSE TONE AND STYLE:
- Be warm, encouraging, and supportive like a helpful older brother (Ravi Bhaiya)
- Use "आप" (formal) or "तुम" (informal) appropriately in Hindi responses
- Base your entire answer on the provided NCERT textbook content
- ${instruction}
- If the question goes beyond the provided content, acknowledge this and provide basic guidance based on fundamental physics principles
- Maintain cultural sensitivity and use examples relevant to Indian students

ANSWER:`;

    return prompt;
  }

  /**
   * Main enhanced method that orchestrates the entire RAG process with language support
   */
  public async generateEnhancedResponse(
    question: string,
    queryEmbedding: number[],
    language: string = "auto",
  ): Promise<{
    prompt: string;
    context: EnhancedContext;
    similarChunks: SimilarityResult[];
  }> {
    console.log(
      `🧠 ENHANCED RAG: Starting bilingual question analysis and context assembly`,
    );

    // Step 1: Analyze the question comprehensively with language detection
    const questionAnalysis = this.analyzeQuestion(question);
    console.log(
      `🧠 ENHANCED RAG: Question analysis - Type: ${questionAnalysis.type}, Intent: ${questionAnalysis.intent}, Language: ${questionAnalysis.detectedLanguage}`,
    );
    console.log(
      `🧠 ENHANCED RAG: Original language keywords: ${questionAnalysis.originalLanguageKeywords.join(", ")}`,
    );

    // Step 2: Find similar chunks with metadata relevance boost
    const similarChunks = await this.findSimilarChunks(
      queryEmbedding,
      questionAnalysis,
      {
        topK: 8, // Get more chunks for better selection
        minSimilarity: 0.1,
        chapterFilter: "8",
      },
    );

    console.log(
      `🧠 ENHANCED RAG: Found ${similarChunks.length} relevant chunks`,
    );
    console.log(
      `🧠 ENHANCED RAG: Metadata relevance scores: ${similarChunks.map((s) => s.metadataRelevanceScore.toFixed(3)).join(", ")}`,
    );

    // Step 3: Assemble enhanced context with question-centric metadata
    const enhancedContext = this.assembleEnhancedContext(
      questionAnalysis,
      similarChunks,
    );

    console.log(`🧠 ENHANCED RAG: Context assembly complete`);
    console.log(
      `🧠 ENHANCED RAG: Response blueprint - Include real-world: ${enhancedContext.responseBlueprint.includeRealWorldExample}, Address misconceptions: ${enhancedContext.responseBlueprint.addressMisconceptions}`,
    );
    console.log(
      `🧠 ENHANCED RAG: Found ${enhancedContext.prioritizedMetadata.primaryConcepts.length} primary concepts, ${enhancedContext.prioritizedMetadata.strategicExamples.length} strategic examples`,
    );

    // Step 4: Generate enhanced prompt with language awareness
    const enhancedPrompt = this.createEnhancedEducationalPrompt(
      question,
      enhancedContext,
      language,
    );

    return {
      prompt: enhancedPrompt,
      context: enhancedContext,
      similarChunks,
    };
  }

  public async mockEmbedding(text: string): Promise<number[]> {
    // Enhanced mock embedding function with bilingual support
    const dimension = 1536;
    const embedding = new Array(dimension).fill(0);

    const lowerText = text.toLowerCase();
    let keywordScore = 0;

    // Calculate keyword relevance for all languages
    const allPhysicsKeywords = [
      ...this.physicsKeywords.english,
      ...this.physicsKeywords.hindi,
      ...this.physicsKeywords.hinglish,
    ];

    for (let i = 0; i < allPhysicsKeywords.length; i++) {
      if (lowerText.includes(allPhysicsKeywords[i])) {
        keywordScore += 1;
        // Add significant values to embedding dimensions based on keyword matches
        const startIdx = (i * 40) % dimension;
        for (let j = 0; j < 40 && startIdx + j < dimension; j++) {
          embedding[startIdx + j] += 0.5 + Math.sin(i * j) * 0.3;
        }
      }
    }

    // Add some base similarity for physics-related terms
    if (keywordScore > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] += Math.sin(i * 0.1) * 0.2;
      }
    }

    // If no keywords found, try to match with stored embeddings for better similarity
    if (keywordScore === 0 && this.embeddings.length > 0) {
      // Use the first stored embedding as a template with some variation
      const templateEmbedding = this.embeddings[0];
      for (let i = 0; i < dimension; i++) {
        embedding[i] = templateEmbedding[i] * 0.1 + Math.random() * 0.1 - 0.05;
      }
    }

    // Normalize the embedding
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  // Legacy methods for backward compatibility
  public assembleContext(similarChunks: SimilarityResult[]): string {
    if (similarChunks.length === 0) {
      return "";
    }

    const contextParts: string[] = [];

    // Categorize chunks by type
    const activities = similarChunks.filter((s) => s.chunk.type === "activity");
    const examples = similarChunks.filter((s) => s.chunk.type === "example");
    const content = similarChunks.filter((s) => s.chunk.type === "content");
    const specialBoxes = similarChunks.filter(
      (s) => s.chunk.type === "special_box",
    );

    // Build context with educational hierarchy
    if (content.length > 0) {
      contextParts.push(`TEXTBOOK CONCEPT:\n${content[0].chunk.content}`);
    }

    if (examples.length > 0) {
      contextParts.push(`TEXTBOOK EXAMPLE:\n${examples[0].chunk.content}`);
    }

    if (activities.length > 0) {
      contextParts.push(`TEXTBOOK ACTIVITY:\n${activities[0].chunk.content}`);
    }

    if (specialBoxes.length > 0) {
      contextParts.push(`TEXTBOOK NOTE:\n${specialBoxes[0].chunk.content}`);
    }

    return contextParts.join("\n\n");
  }

  public createEducationalPrompt(
    question: string,
    context: string,
    language: string = "english",
  ): string {
    const languageInstructions = {
      hindi: "हिंदी में जवाब दें",
      english: "Respond in English",
      hinglish: "Respond in Hinglish (Hindi-English mix)",
    };

    const instruction =
      languageInstructions[language as keyof typeof languageInstructions] ||
      languageInstructions.english;

    return `You are Ravi Bhaiya, an expert NCERT Grade 9 Physics tutor. Use the following official NCERT textbook content to answer the student's question comprehensively.

RELEVANT NCERT TEXTBOOK CONTENT:
${context}

STUDENT QUESTION: ${question}

INSTRUCTIONS:
- Base your answer primarily on the provided NCERT textbook content
- Explain concepts step-by-step appropriate for Grade 9 students (age 14-15)
- Use simple, clear language that students can understand
- Include examples from the textbook when helpful
- Mention related activities if available in the content
- If the question is beyond the provided content, acknowledge this and provide basic guidance
- ${instruction}

ANSWER:`;
  }

  /**
   * Get statistics about bilingual capabilities
   */
  public getBilingualStats(): {
    supportedLanguages: string[];
    keywordCategories: number;
    totalKeywords: number;
    physicsTerms: number;
  } {
    const totalKeywords = Object.values(this.bilingualKeywords).reduce(
      (total, category) => {
        return (
          total +
          category.english.length +
          category.hindi.length +
          category.hinglish.length
        );
      },
      0,
    );

    const physicsTerms =
      this.physicsKeywords.english.length +
      this.physicsKeywords.hindi.length +
      this.physicsKeywords.hinglish.length;

    return {
      supportedLanguages: ["english", "hindi", "hinglish"],
      keywordCategories: Object.keys(this.bilingualKeywords).length,
      totalKeywords,
      physicsTerms,
    };
  }

  /**
   * Test language detection capabilities
   */
  public testLanguageDetection(testQuestions: string[]): Array<{
    question: string;
    detectedLanguage: string;
    confidence: string;
  }> {
    return testQuestions.map((question) => {
      const analysis = this.analyzeQuestion(question);
      return {
        question,
        detectedLanguage: analysis.detectedLanguage,
        confidence:
          analysis.originalLanguageKeywords.length > 0 ? "high" : "medium",
      };
    });
  }

  /**
   * Enhanced findSimilarChunks method that handles legacy signature
   */
  public async findSimilarChunksLegacy(
    queryEmbedding: number[],
    options: {
      topK?: number;
      minSimilarity?: number;
      chapterFilter?: string;
      typeFilter?: string[];
      difficultyFilter?: string[];
    } = {},
  ): Promise<SimilarityResult[]> {
    // Create a basic question analysis for legacy support
    const basicQuestionAnalysis: QuestionAnalysis = {
      type: "conceptual",
      intent: "explanation",
      complexity: "intermediate",
      emotionalIndicators: [],
      keywords: [],
      suggestedDifficulty: "intermediate",
      detectedLanguage: "english",
      originalLanguageKeywords: [],
    };

    return this.findSimilarChunks(
      queryEmbedding,
      basicQuestionAnalysis,
      options,
    );
  }
}

export const ragService = new RagService();
