# TalentLens

### A Smart Platform for Resume Analytics and Accurate Job Recommendation Using Artificial Intelligence

TalentLens is an AI-powered career assistance platform designed to help job seekers understand their resumes, identify suitable career paths, discover relevant job opportunities, and improve their employability.

The platform combines resume parsing, structured resume analysis, AI-powered contextual reasoning, skill-gap identification, job-role matching, and job discovery into a single workflow.

The project is being developed as a final-year major project by a team of four.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Objectives](#objectives)
- [Current Implementation Status](#current-implementation-status)
- [Key Features](#key-features)
- [System Workflow](#system-workflow)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [APIs and External Services](#apis-and-external-services)
- [Google Gemini API](#google-gemini-api)
- [Jobicy API](#jobicy-api)
- [MongoDB](#mongodb)
- [Authentication](#authentication)
- [Resume Analysis Pipeline](#resume-analysis-pipeline)
- [Job Recommendation Pipeline](#job-recommendation-pipeline)
- [Project Structure](#project-structure)
- [Environment Configuration](#environment-configuration)
- [Local Setup](#local-setup)
- [API Flow](#api-flow)
- [Frontend Flow](#frontend-flow)
- [Current Scope](#current-scope)
- [Pending Work](#pending-work)
- [Future Enhancements](#future-enhancements)
- [Security Considerations](#security-considerations)
- [Limitations](#limitations)
- [Development](#development)
- [Project Roadmap](#project-roadmap)
- [Project Status](#project-status)
- [Team](#team)
- [License](#license)

---

# Project Overview

Traditional resume screening and job recommendation systems often rely heavily on keyword matching.

For example, a resume containing the following technologies:

    React
    Node.js
    MongoDB
    Express

may be considered a strong match for a Full Stack Developer role simply because the same keywords appear in the job description.

However, keyword overlap alone does not fully capture:

- The context in which a technology was used
- The relationship between different skills
- Project experience
- Candidate strengths
- Missing skills
- Career-role suitability
- Resume completeness
- Job-description requirements
- The semantic relationship between a candidate and a job

TalentLens aims to address these limitations by combining deterministic processing with AI-powered contextual reasoning.

The current implementation primarily focuses on the Job Seeker workflow.

A job seeker can upload a resume and receive:

- Structured resume information
- Recommended career roles
- Alternative career roles
- Resume strengths
- Missing skills
- Missing resume sections
- Resume improvement suggestions
- Relevant job opportunities
- Resume-to-job matching
- Hybrid keyword, deterministic-context, and Gemini-embedding scoring with explicit method labels
- Domain-aware skill weighting with bounded, explainable scores
- Reviewed, MongoDB-persisted skill catalogue additions
- Editable portfolio preview with browser print/Save as PDF
- Direct application links

---

# Objectives

The project demonstrates four primary objectives.

## Objective 1 — Resume Analytics and Accurate Job Recommendation

Develop a smart resume-analysis and job-recommendation system that goes beyond simple keyword matching.

The system aims to:

- Extract structured information from resumes
- Understand candidate skills and experience
- Identify suitable job roles
- Compare candidate capabilities against job requirements
- Identify skill gaps
- Provide meaningful resume improvement suggestions
- Recommend relevant job opportunities

AI-powered contextual reasoning is used to understand the semantic relationship between a candidate's resume, skills, projects, experience, and potential career roles.

---

## Objective 2 — Resume-to-Portfolio Transformation

Transform successfully extracted professional information into an editable portfolio preview that can be printed or saved as PDF. The MVP omits unavailable sections and does not publish a hosted website.

---

## Objective 3 — Domain-Based Skill Weighting

Job domain is inferred from available title, description, and skills. Domain-specific multipliers prioritize relevant skills while retaining the original keyword baseline and bounding the weighted score.

---

## Objective 4 — Evolving Skill Catalogue

Resume skills not already listed are presented for explicit job-seeker review. Accepted entries are validated, normalized, persisted in MongoDB, and included in recommendation explanations.

---

# Current Implementation Status

The current development focus is the **Job Seeker side** of the platform.

## Implemented

- User registration
- User login
- MongoDB integration
- JWT-based authentication
- Job Seeker dashboard
- Resume upload
- PDF/DOCX resume processing
- Resume text extraction
- AI-powered resume analysis using Google Gemini
- Structured resume normalization
- Career-role recommendation
- Alternative career-role recommendation
- Resume strengths identification
- Missing skill identification
- Missing resume section identification
- Resume improvement suggestions
- Job discovery
- India-oriented job search
- Resume-to-job matching
- Job match scoring
- Score contract: `matchScore`, `finalScore`, and numeric components are finite values in the 0–100 range; `matchScore` is `null` only when no matching evidence exists. The frontend renders invalid or unavailable values as “Match unavailable,” never as a coerced percentage.
- Direct application links
- Responsive result dashboard
- Domain-based skill weighting
- User-reviewed additions to the persistent skill catalogue
- Editable portfolio preview and browser PDF export

## Partially Implemented / Being Refined

- Job matching accuracy
- Job ranking
- India-focused job filtering
- Gemini contextual role scoring based on the structured resume and suggested role titles
- Gemini embedding comparison of resume context and shortlisted job descriptions when configured, with a deterministic text-overlap fallback
- Dashboard UI/UX refinement
- Job provider coverage

## Pending

- Recruiter-side functionality
- Recruiter candidate ranking
- Portfolio customization
- Portfolio publishing/sharing
- Additional job providers for broader India-specific coverage
- Broader semantic candidate retrieval and evaluation

---

# Key Features

## 1. User Authentication

Users can register and log in securely.

The application is designed around two user roles:

- Job Seeker
- Recruiter

The current implementation focuses primarily on the Job Seeker workflow.

---

## 2. Resume Upload

Job seekers can upload their resumes through the web interface.

Supported formats include:

- PDF
- DOCX

Uploaded files are processed by the backend before entering the resume-analysis pipeline.

---

## 3. AI Resume Analysis

Google Gemini is used for contextual reasoning over the extracted resume information.

The system can identify:

- Candidate skills
- Education
- Experience
- Projects
- Certifications
- Achievements
- Strengths
- Suitable job roles
- Alternative job roles
- Missing skills
- Missing resume sections
- Resume improvement suggestions

The AI response is normalized by the backend before being consumed by the React frontend.

This ensures that the frontend receives predictable data structures.

---

## 4. Career Role Recommendation

TalentLens identifies job roles that best align with the candidate's resume.

For example:

    Best Career Match

    Full Stack Developer

    78% Match

Alternative roles can also be suggested when sufficient information is available.

For example:

    Backend Developer
    Frontend Developer
    Software Engineer

The recommendations are generated dynamically from the candidate's resume rather than being hard-coded.

---

## 5. Skill Gap Analysis

The system identifies skills that may improve a candidate's suitability for their target roles.

For example:

    Skills to Improve

    Docker
    TypeScript
    AWS
    Automated Testing

The system attempts to distinguish between skills already demonstrated in the resume and skills that may be relevant but are missing.

---

## 6. Resume Improvement Suggestions

TalentLens can identify areas where the resume itself could be improved.

Examples include:

- Improving project descriptions
- Providing stronger evidence for technical skills
- Adding measurable outcomes
- Improving section completeness
- Making experience descriptions more specific
- Better presenting project contributions

The system avoids recommending that users simply add keywords they do not actually know.

---

## 7. Job Discovery

TalentLens can retrieve available job opportunities using external job data sources.

The current implementation uses the Jobicy public jobs API.

Job listings are normalized and displayed inside the Job Seeker dashboard.

A job may contain:

- Job title
- Company
- Location
- Job type
- Publication date
- Source
- Match score
- Matched skills
- Missing skills
- Original application URL

---

## 8. Resume-to-Job Matching

Job recommendations are not simply displayed in the order returned by the job provider.

The original keyword-based score remains available as a baseline. When `GEMINI_API_KEY` is configured, the backend obtains Gemini text embeddings for a bounded resume profile and up to 20 location-eligible baseline-ranked job descriptions, then combines cosine similarity with the baseline. If embedding calls are unavailable or no key is configured, it uses deterministic overlap across resume context and job text. Match results include matched/missing skills and score components. This first version embeds only the baseline shortlist, so it may not retrieve semantically relevant jobs outside those 20 candidates.

`backend/test/fixtures/matching-evaluation.json` is a small manually reviewed synthetic benchmark. Its tests compare baseline and deterministic-fallback top-one relevance on three examples; this is a regression check, not evidence of broad real-world accuracy or live Gemini embedding quality.

---

## 9. India-Oriented Job Discovery

TalentLens is primarily intended for Indian students, freshers, and job seekers.

The default job-search context is therefore:

    India

rather than a specific city.

The system is designed to prioritize:

1. Jobs located in India
2. Remote jobs that accept candidates from India
3. India-eligible opportunities
4. Global opportunities when the user explicitly broadens the search

Country-restricted opportunities such as:

    United States only
    Canada only
    UK only

should not be recommended as India-focused opportunities.

---

# System Workflow

The current Job Seeker workflow is approximately:

    User
      |
      v
    Login / Register
      |
      v
    Job Seeker Dashboard
      |
      v
    Upload Resume
      |
      v
    Multer
      |
      v
    Resume Text Extraction
      |
      v
    Structured Resume Processing
      |
      v
    Google Gemini
      |
      v
    Resume Analysis / Reasoning
      |
      v
    Backend Normalization Layer
      |
      v
    Career Role Matching
      |
      v
    Job Search Service
      |
      v
    Job Provider
      |
      v
    Job Normalization
      |
      v
    Resume <-> Job Matching
      |
      v
    Ranked Opportunities
      |
      v
    React Dashboard
      |
      v
    Direct Application Links

---

# Architecture

TalentLens follows a separated frontend/backend architecture.

    TalentLens
    |
    +-- backend
    |     |
    |     +-- Node.js
    |     +-- Express.js
    |     +-- MongoDB
    |     +-- Gemini integration
    |     +-- Resume processing
    |     +-- Job search services
    |
    +-- frontend
          |
          +-- React
          +-- Vite
          +-- UI components

The backend follows an MVC-inspired architecture.

    Client Request
          |
          v
        Route
          |
          v
      Controller
          |
          v
       Service
          |
          +---- Database
          |
          +---- Gemini
          |
          +---- Resume Processing
          |
          +---- Job Provider
          |
          v
       Response
          |
          v
        React

This separation keeps sensitive operations and external API credentials on the backend.

---

# Technology Stack

## Frontend

- React
- Vite
- JavaScript
- JSX
- CSS
- Responsive UI

## Backend

- Node.js
- Express.js
- JavaScript
- REST APIs
- MVC-inspired architecture

## Database

- MongoDB

## Authentication

- JSON Web Tokens (JWT)
- Password hashing

## File Upload

- Multer

## Artificial Intelligence

- Google Gemini API

## Job Data

- Jobicy public jobs API

---

# APIs and External Services

TalentLens currently uses the following external services:

| Service | Purpose | API Key Required |
|---|---|---|
| Google Gemini API | AI-powered resume reasoning and contextual analysis | Yes |
| Jobicy API | Job opportunity discovery | No API key for the current public endpoint |
| MongoDB | Persistent application data | Connection string required |

---

# Google Gemini API

Google Gemini is used for contextual AI reasoning.

The Gemini integration is handled entirely by the backend.

The API key is never exposed to the React frontend.

The general flow is:

    Resume Information
          |
          v
        Backend
          |
          v
    Google Gemini API
          |
          v
    Structured JSON
          |
          v
    Backend Validation
          |
          v
    Backend Normalization
          |
          v
        React

Gemini is used for tasks such as:

- Understanding resume context
- Identifying relevant skills
- Determining suitable career roles
- Generating contextual explanations
- Identifying skill gaps
- Generating resume improvement suggestions

Gemini is not responsible for inventing job listings or application URLs.

Real job information comes from external job providers.

---

## Gemini API Key

A Gemini API key can be created through Google AI Studio.

Add it to the backend environment file:

    GEMINI_API_KEY=your_google_gemini_api_key

Job recommendations use the existing Google GenAI SDK embedding endpoint when this key is configured. The optional `GEMINI_EMBEDDING_MODEL` setting defaults to `gemini-embedding-001`. Matching sends a bounded resume profile (excluding top-level name and email) and shortlisted job text from the backend; if embeddings are unavailable, deterministic text-overlap scoring is used. The embedding request is batched for the resume and up to 20 location-eligible, baseline-ranked jobs.

An optional Gemini model can also be configured:

    GEMINI_MODEL=gemini-2.0-flash

The backend should provide a sensible default model if `GEMINI_MODEL` is not specified.

---

# Jobicy API

TalentLens currently uses Jobicy as one of its job opportunity sources.

Jobicy provides a public remote-jobs API.

The current public endpoint does not require an API key.

The backend retrieves available listings and normalizes them before they are returned to the frontend.

The available job information may include:

- Job title
- Company
- Location
- Job type
- Description
- Publication date
- Original job URL

The original job listing URL is used for the application link.

---

## Jobicy Limitations

Jobicy is primarily a remote-jobs source and therefore does not provide comprehensive coverage of all Indian job listings.

Because of this limitation, TalentLens does not claim that Jobicy represents the complete Indian job market.

The application uses geographic filtering and ranking to prioritize India-oriented opportunities where sufficient location or eligibility information is available.

The job source is displayed to users.

Future versions can integrate additional job providers to improve India-specific coverage.

---

# Future Job Providers

The job-search architecture is designed to support multiple providers.

A future implementation may integrate additional job APIs with stronger India-specific coverage.

One possible provider is Adzuna, which provides country-specific job search APIs and supports keyword and location-based searches.

However, Adzuna requires application credentials and therefore is not required for the current basic prototype.

The intended architecture is:

    Job Search Service
          |
          +-- Jobicy Provider
          |
          +-- Adzuna Provider
          |
          +-- Future Providers

This allows additional job sources to be introduced without requiring a complete frontend rewrite.

---

# MongoDB

MongoDB is used as the primary database.

It currently supports application data such as:

- User accounts
- User roles
- Authentication-related information
- Other persistent application data

The database connection is configured through an environment variable.

Example:

    MONGODB_URI=your_mongodb_connection_string

---

# Authentication

TalentLens uses token-based authentication.

The general authentication flow is:

    Register
       |
       v
    Securely store user credentials
       |
       v
    Login
       |
       v
    JWT issued
       |
       v
    Authenticated API requests
       |
       v
    Protected dashboard

The application is designed to support:

    Job Seeker
    Recruiter

The current implementation focuses on the Job Seeker side.

---

# Resume Analysis Pipeline

The current resume-analysis pipeline is:

    1. User uploads resume
             |
             v
    2. Multer receives the file
             |
             v
    3. Backend extracts resume text
             |
             v
    4. Resume information is processed
             |
             v
    5. Google Gemini performs contextual analysis
             |
             v
    6. Gemini returns structured analysis
             |
             v
    7. Backend validates and normalizes the response
             |
             v
    8. Career roles are identified
             |
             v
    9. Skill gaps are identified
             |
             v
    10. Resume improvement suggestions are generated
             |
             v
    11. Results are returned to React

A normalization layer is important because AI-generated output cannot be assumed to always follow the expected frontend structure.

For example, collection fields should consistently use arrays:

    skills: []
    education: []
    experience: []
    projects: []
    missingSkills: []
    missingSections: []
    improvementSuggestions: []

This prevents malformed AI responses from breaking the frontend.

---

# Job Recommendation Pipeline

The current job recommendation process is:

    Candidate Resume
          |
          v
    Best Career Role
          |
          v
    Job Search Query
          |
          v
    Job Provider
          |
          v
    Available Job Listings
          |
          v
    Normalize Job Data
          |
          v
    Compare Resume with Job
          |
          v
    Calculate Match
          |
          v
    Rank Jobs
          |
          v
    Display Recommended Opportunities
          |
          v
    Original Application Link

The objective is to make the recommendation actionable rather than simply telling a candidate:

    "You are suitable for Full Stack Development."

Instead, TalentLens aims to help the candidate discover actual opportunities corresponding to that career direction.

---

# Project Structure

The repository is organized into separate frontend and backend applications.

    TalentLens/
    |
    +-- backend/
    |   |
    |   +-- src/
    |   |   |
    |   |   +-- controllers/
    |   |   |   +-- analysisController.js
    |   |   |   +-- authController.js
    |   |   |
    |   |   +-- middleware/
    |   |   |   +-- auth.js
    |   |   |
    |   |   +-- models/
    |   |   |   +-- User.js
    |   |   |
    |   |   +-- routes/
    |   |   |   +-- analysis.js
    |   |   |   +-- auth.js
    |   |   |
    |   |   +-- services/
    |   |       +-- resumePipelineService.js
    |   |       +-- jobSearchService.js
    |   |   +-- data/
    |   |       +-- jobRoles.js
    |   |
    |   +-- .env
    |   +-- package.json
    |   +-- package-lock.json
    |   +-- test/
    |       +-- matching.test.js
    |       +-- passwordReset.test.js
    |
    +-- frontend/
    |   |
    |   +-- src/
    |   |   |
    |   |   +-- assets/
    |   |   +-- components/
    |   |   +-- lib/
    |   |   +-- pages/
    |   |   +-- App.jsx
    |   |   +-- ...
    |   |
    |   +-- public/
    |   +-- package.json
    |   +-- ...
    |
    +-- package.json
    +-- README.md

The exact structure may evolve as additional project modules are implemented.

---

# Environment Configuration

All sensitive credentials must remain in the backend environment.

Create manually (there is no checked-in environment example):

    backend/.env

Example configuration:

    MONGODB_URI=your_mongodb_connection_string

    JWT_SECRET=your_long_random_jwt_secret

    GEMINI_API_KEY=your_google_gemini_api_key

    GEMINI_MODEL=gemini-2.0-flash

Jobicy currently does not require an API key for the public endpoint.

---

# Environment Security

Never commit the following file to Git:

    .env

Never expose the following values through frontend environment variables:

    GEMINI_API_KEY
    MONGODB_URI
    JWT_SECRET

All protected external services should be accessed from the backend.

---

# Local Setup

## 1. Clone the repository

    git clone <repository-url>
    cd TalentLens

---

## 2. Install dependencies

    npm install
    npm --prefix backend install
    npm --prefix frontend install

---

## 3. Configure environment variables

Create:

    backend/.env

Configure these backend-only variables in `backend/.env`:

    MONGODB_URI=your_mongodb_connection_string
    JWT_SECRET=your_long_random_jwt_secret
    GEMINI_API_KEY=your_google_gemini_api_key

`GEMINI_MODEL` is optional; the backend defaults to `gemini-3.6-flash`.

---

## 4. Start the application

    npm run dev

Other available root commands:

    npm test
    npm run lint
    npm run build

The frontend should be available at:

    http://127.0.0.1:5173

The Express backend runs on:

    http://127.0.0.1:5000

The frontend proxies `/api` requests to the Express backend.

Password recovery is temporarily unavailable: no secure email-delivery provider is configured, so the backend does not issue or return reset tokens. Configure real email delivery before enabling password-reset requests.

---

# Frontend Development

The frontend is built using React and Vite.

Typical development command:

    cd frontend
    npm run dev

The Vite development server provides hot module replacement during development.

---

# Backend Development

The backend uses Node.js and Express.

The backend is responsible for:

- Authentication
- Authorization
- Database access
- Resume upload handling
- Resume processing
- Gemini communication
- Analysis normalization
- Job-provider communication
- Job matching

The React application does not directly communicate with Gemini or other protected services.

---

# API Flow

## Authentication

Typical authentication routes include:

    POST /api/auth/register
    POST /api/auth/login

Authentication middleware protects private functionality.

---

## Resume Analysis

The analysis route receives an authenticated resume upload.

The general request flow is:

    React
      |
      v
    Analysis API
      |
      v
    Authentication Middleware
      |
      v
    Multer
      |
      v
    Analysis Controller
      |
      v
    Analysis Service
      |
      v
    Gemini
      |
      v
    Normalized Result
      |
      v
    React

Exact endpoint names may evolve as the implementation develops.

---

# Frontend Flow

The Job Seeker frontend currently follows this general flow:

    Landing / Login
          |
          v
    Job Seeker Authentication
          |
          v
    Job Seeker Dashboard
          |
          v
    Resume Upload
          |
          v
    Resume Analysis
          |
          v
    Analysis Result Dashboard
          |
          +-- Best Career Match
          |
          +-- Alternative Roles
          |
          +-- Strengths
          |
          +-- Skill Gaps
          |
          +-- Resume Improvements
          |
          +-- Recommended Jobs
          |
          +-- Direct Application Links
          |
          +-- Extracted Resume Information

Sections are rendered dynamically based on available analysis data.

Empty or meaningless sections should not be displayed.

---

# Current Scope

At the current stage, the **Job Seeker resume-analysis and job-discovery workflow is the primary implemented module**.

The project is being developed incrementally.

The current priority is to make the Job Seeker experience reliable and useful before implementing the remaining major modules.

The implemented Job Seeker workflow currently focuses on:

    Resume
      |
      v
    Resume Analysis
      |
      v
    Career Recommendation
      |
      v
    Skill Gap Analysis
      |
      v
    Resume Improvement
      |
      v
    Job Discovery
      |
      v
    Job Matching
      |
      v
    Application

---

# Pending Work

## 1. Recruiter Module

The Recruiter side is planned but is not the current development focus.

Planned functionality includes:

- Recruiter authentication
- Job description input
- Multiple resume uploads
- Resume parsing
- Candidate ranking
- Resume-to-job matching
- Candidate comparison
- Candidate filtering
- Shortlist generation
- Relevant candidate insights

The planned recruiter workflow is:

    Recruiter
       |
       v
    Create / Upload Job Description
       |
       v
    Upload Candidate Resumes
       |
       v
    Resume Parsing
       |
       v
    Candidate <-> Job Matching
       |
       v
    Rank Candidates
       |
       v
    Top Candidate Recommendations

---

# 2. Portfolio Publishing — Future Work

The portfolio preview and print-to-PDF MVP is implemented in the job-seeker dashboard. Hosting, publishing, and sharing portfolios remain future work.

The planned workflow is:

    Resume
       |
       v
    Structured Resume Data
       |
       v
    Portfolio Template
       |
       v
    Generated Portfolio
       |
       v
    Preview
       |
       v
    Customize
       |
       v
    Publish / Share

The portfolio MVP is expected to generate sections such as:

- About
- Skills
- Education
- Experience
- Projects
- Certifications
- Achievements
- Contact information is deliberately excluded from generated portfolios.

The MVP converts available resume information into an editable, presentable preview without publishing a hosted website.

---

# Future Enhancements

## Job Recommendation

Potential future improvements include:

- Additional job APIs
- Stronger India-specific job coverage
- Improved semantic job matching
- Personalized job ranking
- Job alerts
- Saved jobs
- Application tracking
- Job recommendation personalization
- Location-based filtering
- Experience-level filtering

---

## Resume Analytics

Potential future improvements include:

- More advanced ATS-oriented analysis
- Better experience analysis
- Project quality analysis
- Skill proficiency inference
- Role-specific resume recommendations
- Better semantic skill matching
- Resume version comparison

---

## Recruiter Features

Potential recruiter-side improvements include:

- Advanced candidate ranking
- Candidate filtering
- Recruiter dashboard
- Candidate comparison
- Shortlist management
- Job-specific candidate recommendations
- Candidate search

---

## Portfolio

Potential portfolio improvements include:

- Multiple portfolio templates
- Custom themes
- Portfolio customization
- Custom domain support
- Portfolio publishing
- GitHub integration
- LinkedIn integration
- Project showcase
- Responsive portfolio generation

---

## Personalization

Future versions may allow users to specify:

- Preferred job locations
- Preferred job types
- Experience level
- Preferred industries
- Preferred career roles
- Remote/on-site preference

---

# Security Considerations

The application follows a backend-first approach for sensitive operations.

## API Keys

Gemini credentials remain on the backend.

## Authentication

Protected routes require authentication.

## Passwords

Passwords should never be stored in plain text.

## Environment Variables

Secrets are stored in environment variables and should never be committed to the repository.

## Resume Files

Uploaded resumes should be handled carefully and should not be exposed publicly without authorization.

## External URLs

Job application links should originate from trusted job providers or verified search URLs.

Gemini should never be trusted to generate arbitrary application URLs.

---

# Limitations

The current prototype has several limitations.

## Job Data Coverage

The current Jobicy integration is primarily oriented toward remote jobs and therefore does not provide comprehensive coverage of all Indian job listings.

Additional providers may be integrated in future versions.

---

## AI Accuracy

Gemini provides contextual reasoning but remains a probabilistic AI system.

Its output must therefore be:

- Structured
- Validated
- Normalized
- Interpreted carefully

The system does not claim that AI recommendations are perfectly accurate.

---

## Job Match Accuracy

Job matching currently depends on the quality and completeness of available resume and job information.

Further evaluation and improvements can address:

- Embedding shortlist recall and ranking quality
- Larger, independently reviewed evaluation datasets
- Domain-specific skill taxonomies
- Experience weighting
- Education relevance
- Location eligibility
- Better job requirement extraction
- More advanced NLP techniques

---

## Job Provider Limitations

External job APIs may have:

- Limited geographic coverage
- Limited job categories
- Delayed listings
- Rate limits
- Provider-specific restrictions

Therefore, TalentLens does not claim to represent every available job opportunity.

---

## Portfolio Generation

The resume-to-portfolio module is not yet implemented in the current version.

---

## Recruiter Module

The recruiter workflow is currently pending.

---

# Development Philosophy

TalentLens follows a hybrid approach rather than relying entirely on generative AI.

The system combines:

    Deterministic Processing
            +
    Structured Data Normalization
            +
    Rule-Based Matching
            +
    AI Contextual Reasoning
            +
    External Job Data

This approach is intended to provide greater reliability than using an LLM for every part of the system.

For example:

### Google Gemini

Used for:

- Contextual understanding
- Semantic interpretation
- Resume reasoning
- Career-role recommendations
- Skill-gap analysis
- Personalized resume suggestions

### Backend Logic

Used for:

- Validation
- Normalization
- Authentication
- Authorization
- Deterministic calculations
- Data transformation
- Job filtering
- Job ranking

### External APIs

Used for:

- Real-world job information

This separation makes the system easier to debug, maintain, and extend.

---

# Project Roadmap

    PHASE 1
    |
    +-- Authentication
    +-- MongoDB Integration
    +-- Job Seeker UI
    +-- Resume Upload
    |
    +-- COMPLETED

    PHASE 2
    |
    +-- Resume Text Extraction
    +-- AI Resume Analysis
    +-- Career Role Recommendation
    +-- Skill Gap Analysis
    +-- Resume Improvement Suggestions
    +-- Job Discovery
    +-- Initial Job Matching
    |
    +-- IMPLEMENTED / BEING REFINED

    PHASE 3
    |
    +-- Improved Job Matching
    +-- India-focused Job Discovery
    +-- Recruiter Module
    +-- Candidate Ranking
    |
    +-- PENDING

    PHASE 4
    |
    +-- Resume -> Portfolio MVP
    +-- Portfolio Templates
    +-- Portfolio Customization
    +-- Portfolio Publishing
    |
    +-- PENDING

    FUTURE
    |
    +-- Advanced AI Matching
    +-- Additional Job Providers
    +-- Job Alerts
    +-- Application Tracking
    +-- GitHub Integration
    +-- LinkedIn Integration
    +-- Advanced Recruiter Features

---

# Project Status

**Status: Active Development**

## Implemented

- Authentication
- User registration
- User login
- MongoDB integration
- Job Seeker workflow
- Resume upload
- Resume text extraction
- Gemini-powered resume analysis
- Structured resume normalization
- Career-role recommendation
- Alternative career roles
- Skill-gap analysis
- Resume improvement suggestions
- Job discovery
- Initial job matching
- India-oriented job filtering
- Direct job application links
- Dynamic result dashboard

## Pending

- Recruiter-side implementation
- Advanced recruiter candidate ranking
- Resume-to-portfolio MVP
- Portfolio customization
- Portfolio publishing
- Advanced semantic job matching
- Additional India-focused job providers
- Job alerts and application tracking

---

# Team

TalentLens is being developed as a final-year major project by a team of four students.

The project combines concepts from:

- Artificial Intelligence
- Natural Language Processing
- Full-Stack Web Development
- Database Systems
- REST API Architecture
- Resume Analytics
- Job Recommendation Systems
- Information Retrieval
- Human-Centered Product Design

The goal is to develop a practical platform that helps job seekers move from:

    Resume
       |
       v
    Career Understanding
       |
       v
    Skill Improvement
       |
       v
    Job Discovery
       |
       v
    Job Application

---

# License

This project is currently being developed as an academic final-year major project.

If the project is later released publicly as an open-source project, an appropriate open-source license can be added here.

---

# Acknowledgements

TalentLens makes use of several technologies and services that enable the current prototype:

- React and Vite for the frontend
- Node.js and Express for the backend
- MongoDB for persistent data storage
- Multer for file uploads
- Google Gemini API for AI-powered contextual analysis
- Jobicy API for job opportunity discovery

These services are integrated into the application through the backend wherever sensitive credentials or server-side processing are required.
