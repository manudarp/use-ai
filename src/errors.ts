export class AICoreError extends Error {

  constructor(message: string) {

    super(message);

    this.name =
      "AICoreError";

    Object.setPrototypeOf(
      this,
      new.target.prototype
    );
  }
}

export class AIConfigurationError
  extends AICoreError {

  constructor(message: string) {

    super(message);

    this.name =
      "AIConfigurationError";
  }
}

export class AIProviderError
  extends AICoreError {

  constructor(message: string) {

    super(message);

    this.name =
      "AIProviderError";
  }
}

export class KnowledgeBaseError
  extends AICoreError {

  constructor(message: string) {

    super(message);

    this.name =
      "KnowledgeBaseError";
  }
}