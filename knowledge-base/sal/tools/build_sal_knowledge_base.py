from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


SOURCE_PDF = Path(
    r"C:\Users\marthakaburi\.copilot\attachments"
    r"\14e9a2ba-79c3-4c02-a15d-191482f34467-SAL_Final_Teacher_Librarian_Guide.pdf"
)
OUTPUT_DIR = Path(
    r"C:\Users\marthakaburi\.copilot\session-state"
    r"\7b897c4a-864e-4391-8180-3f021ac5b309\files"
)
SOURCE_NAME = "SAL Final Teacher Librarian Guide"
SOURCE_ORGANIZATION = "Start A Library Trust (SAL)"


@dataclass(frozen=True)
class Heading:
    match: str
    title: str
    chapter: str
    section: str
    topic: str
    tags: tuple[str, ...]
    content_type: str = "guidance"


HEADINGS = [
    Heading("Background", "Background: Kenya's Foundational Learning Context", "Background", "background", "organization_and_context", ("foundational literacy", "Kenya", "learning crisis")),
    Heading("About Start A Library Trust (SAL)", "About Start A Library Trust", "Background", "about-sal", "organization_and_context", ("SAL", "mission", "program pillars")),
    Heading("Purpose of the manual", "Purpose and Intended Use of the Manual", "Background", "manual-purpose", "organization_and_context", ("manual", "teacher librarian", "learning outcomes")),
    Heading("1.1 Why a Library?", "Why a School Library Matters", "Chapter 1: Introduction to Libraries", "1.1", "library_foundations", ("school library", "foundational literacy", "safe learning space")),
    Heading("1.2 Role of the Teacher Librarian", "Role and Responsibilities of the Teacher Librarian", "Chapter 1: Introduction to Libraries", "1.2", "teacher_librarian_role", ("teacher librarian", "responsibilities", "reading culture")),
    Heading("1.3 Core Competencies of a Teacher Librarian", "Core Competencies of a Teacher Librarian", "Chapter 1: Introduction to Libraries", "1.3", "teacher_librarian_role", ("competencies", "facilitation", "leadership", "safeguarding")),
    Heading("2.1 What is a library?", "What SAL Means by a School Library", "Chapter 2: Practical School Library Operations", "2.1", "library_operations", ("library definition", "child-friendly space", "school library")),
    Heading("2.2 Setting Up the Library Space", "Setting Up a Child-Friendly Library Space", "Chapter 2: Practical School Library Operations", "2.2", "library_space", ("library setup", "reading corners", "displays", "accessibility")),
    Heading("2.3 Organizing and arranging Books", "Organizing and Arranging Books", "Chapter 2: Practical School Library Operations", "2.3", "book_organization", ("bookshelves", "grade level", "fiction", "non-fiction")),
    Heading("2.4 Book Coding, Labeling and Numbering", "Book Coding, Labeling and Numbering", "Chapter 2: Practical School Library Operations", "2.4", "book_inventory", ("book codes", "labels", "accountability")),
    Heading("2.5 Borrowing and Returning Procedures", "Borrowing, Returning and Selecting Suitable Books", "Chapter 2: Practical School Library Operations", "2.5", "circulation_and_book_selection", ("borrowing", "returns", "five finger rule", "reading level")),
    Heading("2.6 Daily and Weekly Duties of the Teacher Librarian", "Daily and Weekly Library Duties", "Chapter 2: Practical School Library Operations", "2.6", "library_routines", ("daily duties", "weekly duties", "library management")),
    Heading("2.7 Library Rules and Learner Discipline", "Library Rules and Learner Discipline", "Chapter 2: Practical School Library Operations", "2.7", "library_rules", ("library rules", "learner discipline", "book care")),
    Heading("2.8 Record Keeping and Documentation", "Record Keeping, Documentation and Stocktaking", "Chapter 2: Practical School Library Operations", "2.8", "records_and_reporting", ("records", "stocktaking", "inventory", "attendance")),
    Heading("2.9 Maintaining a Safe and Attractive Library Environment", "Maintaining a Safe and Attractive Library", "Chapter 2: Practical School Library Operations", "2.9", "library_space", ("maintenance", "book repair", "displays", "welcoming environment")),
    Heading("3.1 Introduction", "Reading Activities: Purpose and Approach", "Chapter 3: Bringing Books to Life", "3.1", "reading_activities", ("literacy activities", "social-emotional learning", "reading for pleasure")),
    Heading("➢ 3.1.1 Flagship programs", "SAL Flagship Reading Programs", "Chapter 3: Bringing Books to Life", "3.1.1", "sal_programs", ("flagship programs", "National Read Aloud", "book clubs")),
    Heading("3.2 Principles for Conducting Reading Activities", "Principles for Conducting Reading Activities", "Chapter 3: Bringing Books to Life", "3.2", "activity_facilitation", ("participation", "inclusion", "learner ability", "facilitation")),
    Heading("3.3 Life Skills & Values Integration in Reading Activities", "Integrating Life Skills and Values into Reading", "Chapter 3: Bringing Books to Life", "3.3", "life_skills_and_values", ("life skills", "values", "reflection questions", "social-emotional learning")),
    Heading("a) Read Aloud", "Reading Activity: Read Aloud", "Chapter 3: Bringing Books to Life", "3.4.a", "read_aloud", ("read aloud", "fluency", "pronunciation", "comprehension"), "activity_guide"),
    Heading("b) Storytelling / Story Narration", "Reading Activity: Storytelling and Story Narration", "Chapter 3: Bringing Books to Life", "3.4.b", "storytelling", ("storytelling", "oral language", "retelling", "reluctant readers"), "activity_guide"),
    Heading("c) Spelling Bee", "Reading Activity: Spelling Bee", "Chapter 3: Bringing Books to Life", "3.4.c", "spelling_bee", ("spelling", "vocabulary", "competition", "confidence"), "activity_guide"),
    Heading("d) Debate", "Reading Activity: Debate", "Chapter 3: Bringing Books to Life", "3.4.d", "debate", ("debate", "critical thinking", "public speaking", "respect"), "activity_guide"),
    Heading("e) Dramatization / Role Play.", "Reading Activity: Dramatization and Role Play", "Chapter 3: Bringing Books to Life", "3.4.e", "dramatization_and_role_play", ("role play", "dramatization", "creativity", "teamwork"), "activity_guide"),
    Heading("f) Story Building", "Reading Activity: Story Building", "Chapter 3: Bringing Books to Life", "3.4.f", "story_building", ("story building", "sequencing", "imagination", "collaboration"), "activity_guide"),
    Heading("g) Anagram (Word Building)", "Reading Activity: Anagram and Word Building", "Chapter 3: Bringing Books to Life", "3.4.g", "anagram_word_building", ("anagram", "word building", "vocabulary", "spelling"), "activity_guide"),
    Heading("h) Book Club Session Guide and Structure", "Book Club Session Guide and Structure", "Chapter 3: Bringing Books to Life", "3.4.h", "book_clubs", ("book club", "discussion questions", "reading ambassadors", "session structure"), "activity_guide"),
    Heading("4.1 Introduction", "Building a School-Wide Reading Culture", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.1", "reading_culture", ("reading culture", "whole school", "stakeholders")),
    Heading("4.2 Understanding a Reading Culture", "Understanding a Reading Culture", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.2", "reading_culture", ("reading habits", "voluntary reading", "school culture")),
    Heading("4.3 The Role of School Leadership", "Role of School Leadership", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.3", "school_leadership", ("headteacher", "school administration", "timetable", "resources")),
    Heading("4.4 Involving Classroom Teachers", "Involving Classroom Teachers", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.4", "teacher_engagement", ("classroom teachers", "curriculum integration", "struggling readers")),
    Heading("4.5 Learner Participation and Leadership - Junior Reading Champions (Library", "Junior Reading Champions: Selection, Duties and Transition", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.5", "learner_leadership", ("Junior Reading Champions", "library prefects", "selection", "onboarding", "handover")),
    Heading("4.6 Organizing School Reading Activities and Events", "Organizing School Reading Activities and Events", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.6", "reading_events", ("reading competitions", "reading challenges", "guest readers", "literacy displays")),
    Heading("4.7 Parental Engagement", "Parent and Caregiver Engagement", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.7", "parental_engagement", ("parents", "caregivers", "Kusoma Bags", "reading at home")),
    Heading("4.8 Creating Partnerships and Community Support", "Partnerships and Community Support", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.8", "community_partnerships", ("community partners", "donations", "mentors", "Pen Pal Program")),
    Heading("4.9 Addressing Common Challenges in Promoting Reading Culture", "Challenges and Responses in Promoting Reading Culture", "Chapter 4: Reading Culture and Stakeholder Engagement", "4.9", "reading_culture_challenges", ("low learner interest", "teacher involvement", "parent support", "limited materials")),
    Heading("5.1 Introduction", "Monitoring, Reporting and Continuous Improvement", "Chapter 5: Monitoring and Sustainability", "5.1", "monitoring_and_evaluation", ("monitoring", "reporting", "continuous improvement", "EGRA")),
    Heading("5.2 Why Monitoring and Reporting Matter", "Why Monitoring and Reporting Matter", "Chapter 5: Monitoring and Sustainability", "5.2", "monitoring_and_evaluation", ("participation", "borrowing trends", "accountability", "decision-making")),
    Heading("5.3 Key Areas to Monitor", "Key Areas and Indicators to Monitor", "Chapter 5: Monitoring and Sustainability", "5.3", "monitoring_indicators", ("library use", "literacy skills", "life skills", "library quality")),
    Heading("5.4 Sustainability of the School Library Program", "Sustaining the School Library Program", "Chapter 5: Monitoring and Sustainability", "5.4", "program_sustainability", ("school ownership", "continuity", "resources", "community support")),
    Heading("Appendix 1: Book Inventory Register", "Template: Book Inventory Register", "Appendix", "A1", "record_templates", ("inventory register", "stocktaking", "template"), "template"),
    Heading("Appendix 2: Borrowing and Returning Register", "Template: Borrowing and Returning Register", "Appendix", "A2", "record_templates", ("borrowing register", "returns", "template"), "template"),
    Heading("Appendix 3: Library Attendance Register", "Template: Library Attendance Register", "Appendix", "A3", "record_templates", ("attendance register", "library visits", "template"), "template"),
    Heading("Appendix 4: Sample Reading Diary/ Shajara", "Template: Reading Diary or Shajara", "Appendix", "A4", "learner_reading_records", ("reading diary", "Shajara", "reflection", "new vocabulary"), "template"),
    Heading("Appendix 5: Book Care and Repair Tips", "Book Care and Repair Tips", "Appendix", "A5", "book_care_and_repair", ("book repair", "torn pages", "spine repair"), "procedure"),
    Heading("Appendix 6: Book club session plan – 1 hour", "Template: One-Hour Book Club Session Plan", "Appendix", "A6", "session_plans", ("book club", "one-hour plan", "discussion", "creative activity"), "template"),
    Heading("Appendix 7: Library reading activity session plan – 35 mins", "Template: 35-Minute Library Reading Activity Plan", "Appendix", "A7", "session_plans", ("reading pledge", "35-minute plan", "literacy activity"), "template"),
]


IMAGE_SECTIONS = [
    {
        "title": "Poster: Writing Tips and Selecting Suitable Books",
        "chapter": "Appendix",
        "section": "A8.1",
        "topic": "library_posters",
        "tags": ["writing tips", "book selection", "five finger rule", "poster"],
        "content_type": "poster_transcription",
        "page_start": 40,
        "page_end": 40,
        "text": (
            "Writing tips: Write clear, short sentences. Use capital letters at the beginning "
            "and full stops at the end. Check spelling and punctuation. Use paragraphs to "
            "organize ideas. Read your work again to correct mistakes.\n\n"
            "Tips for selecting books: Choose books according to the learner's reading level. "
            "Use the Five Finger Rule. Look at the cover and title to predict the story. Choose "
            "books that match learners' interests. Encourage learners to try different books."
        ),
    },
    {
        "title": "Poster: Library Rules and Reading Motivation",
        "chapter": "Appendix",
        "section": "A8.2",
        "topic": "library_posters",
        "tags": ["library rules", "reading motivation", "poster", "book care"],
        "content_type": "poster_transcription",
        "page_start": 41,
        "page_end": 41,
        "text": (
            "Library rules: Keep the library clean. Read silently and do not make noise. "
            "Keep food and drinks out of the library. Do not tear, fold or write on books. "
            "Use a bookmark instead of folding pages. Return books on time. Return books "
            "to the teacher librarian after reading. Handle books with clean hands. Keep "
            "books away from water and fire. Report damaged books to the teacher librarian.\n\n"
            "Reading motivation: Reading is dreaming with open eyes. The more that you read, "
            "the more things you will know. The more that you learn, the more places you'll go. "
            "Today a reader, tomorrow a leader. Reading gives us someplace to go when we have "
            "to stay where we are."
        ),
    },
    {
        "title": "Reading Pledge - English",
        "chapter": "Appendix",
        "section": "A8.3",
        "topic": "reading_pledge",
        "tags": ["reading pledge", "English", "weekly reading", "reading motivation"],
        "content_type": "pledge_transcription",
        "page_start": 42,
        "page_end": 42,
        "text": (
            "I pledge to read stories for fun, to imagine, explore and learn. By reading every "
            "week for at least one hour, I will boost my brain power. Power power! Reading "
            "introduces new words and shows how sentences work together. Reading helps me "
            "understand others. Reading exposes me to new ideas and unlimited possibilities. "
            "Opens my mind to unseen worlds and exciting opportunities. Reading boosts my "
            "brain power. Power power! I read regularly. I am a Reading Revolutionary. "
            "Reading is cool! Kusoma ni poa!"
        ),
    },
    {
        "title": "Ahadi ya Kusoma - Kiswahili",
        "chapter": "Appendix",
        "section": "A8.4",
        "topic": "reading_pledge",
        "tags": ["reading pledge", "Kiswahili", "weekly reading", "reading motivation"],
        "content_type": "pledge_transcription",
        "page_start": 43,
        "page_end": 43,
        "language": "sw",
        "text": (
            "Ninaahidi kusoma hadithi kwa ajili ya kujifurahisha, kufikiria, kuchunguza na "
            "kujifunza. Kwa kusoma kila wiki kwa angalau saa moja, nitaongeza nguvu ya ubongo "
            "wangu. Nguvu! Nguvu! Kusoma hunitambulisha kwa maneno mapya na kunionyesha jinsi "
            "sentensi zinavyofanya kazi pamoja. Kusoma hunisaidia kuwaelewa wengine. Kusoma "
            "hunifungulia mawazo mapya na fursa zisizo na kikomo. Kusoma hufungua akili yangu "
            "kwa ulimwengu usioonekana na fursa za kusisimua. Kusoma huongeza nguvu ya ubongo "
            "wangu. Nguvu! Nguvu! Mimi husoma mara kwa mara. Mimi ni Mwanamapinduzi wa Kusoma. "
            "Kusoma ni poa!"
        ),
    },
    {
        "title": "Child Safeguarding Tips",
        "chapter": "Appendix",
        "section": "A9",
        "topic": "child_safeguarding",
        "tags": ["child safeguarding", "safe environment", "reporting", "confidentiality"],
        "content_type": "safeguarding_guidance_transcription",
        "page_start": 44,
        "page_end": 44,
        "text": (
            "Create a safe and respectful environment where every child feels valued and "
            "included. Treat all children fairly regardless of gender, ability, background or "
            "reading level. Use positive discipline and never use physical punishment, "
            "humiliation, threats or abusive language. Avoid being alone with a child in a "
            "closed or hidden space; conduct activities in open, visible and supervised areas. "
            "Do not take or share photos or videos of children without following the school's "
            "and SAL's consent and safeguarding procedures. Maintain appropriate boundaries "
            "with learners and avoid favouritism, inappropriate touching or private "
            "communication. Listen calmly if a child raises a concern; do not investigate or "
            "promise secrecy. Record and report safeguarding concerns immediately through the "
            "school's and SAL's approved reporting procedures. Protect confidentiality and "
            "share information only with authorized safeguarding personnel."
        ),
    },
]

LEARNING_OBJECTIVE_SECTIONS = [
    {
        "title": "Chapter 1 Learning Objectives",
        "chapter": "Chapter 1: Introduction to Libraries",
        "section": "1.0",
        "topic": "library_foundations",
        "tags": ["learning objectives", "school library", "teacher librarian", "competencies"],
        "content_type": "learning_objectives",
        "page_start": 5,
        "page_end": 5,
        "text": (
            "By the end of this chapter, the teacher librarian should be able to explain the "
            "role of a school library in supporting foundational learning; describe the role "
            "and responsibilities of a teacher librarian; explain how school libraries "
            "contribute to literacy, life skills and social-emotional learning; and identify "
            "the core competencies required to manage a school library effectively."
        ),
    },
    {
        "title": "Chapter 2 Learning Objectives",
        "chapter": "Chapter 2: Practical School Library Operations",
        "section": "2.0",
        "topic": "library_operations",
        "tags": ["learning objectives", "library resources", "records", "learner-friendly library"],
        "content_type": "learning_objectives",
        "page_start": 8,
        "page_end": 8,
        "text": (
            "By the end of this chapter, the teacher librarian should be able to organize and "
            "manage library resources; apply basic library management procedures; maintain "
            "accurate library records; create a learner-friendly library environment; and "
            "identify the core competencies required to manage a school library effectively."
        ),
    },
    {
        "title": "Chapter 3 Learning Objectives",
        "chapter": "Chapter 3: Bringing Books to Life",
        "section": "3.0",
        "topic": "reading_activities",
        "tags": ["learning objectives", "literacy activities", "reading for pleasure", "life skills"],
        "content_type": "learning_objectives",
        "page_start": 14,
        "page_end": 14,
        "text": (
            "By the end of this chapter, the teacher librarian should be able to plan and "
            "facilitate engaging literacy activities; promote reading for pleasure; integrate "
            "life skills and social-emotional learning into reading activities; and use "
            "stories to strengthen learners' literacy development."
        ),
    },
    {
        "title": "Chapter 4 Learning Objectives",
        "chapter": "Chapter 4: Reading Culture and Stakeholder Engagement",
        "section": "4.0",
        "topic": "reading_culture",
        "tags": ["learning objectives", "partnerships", "parents", "learner leadership", "community"],
        "content_type": "learning_objectives",
        "page_start": 27,
        "page_end": 27,
        "text": (
            "By the end of this chapter, the teacher librarian should be able to build "
            "partnerships that support literacy; engage parents and caregivers in children's "
            "reading; promote learner leadership; and mobilize community support for library "
            "programs."
        ),
    },
    {
        "title": "Chapter 5 Learning Objectives",
        "chapter": "Chapter 5: Monitoring and Sustainability",
        "section": "5.0",
        "topic": "monitoring_and_evaluation",
        "tags": ["learning objectives", "records", "learner progress", "reporting", "data use"],
        "content_type": "learning_objectives",
        "page_start": 34,
        "page_end": 34,
        "text": (
            "By the end of this chapter, the teacher librarian should be able to maintain "
            "accurate library records; monitor learner participation and progress; report "
            "library activities and outcomes; and use data to improve literacy programs."
        ),
    },
]


TOPIC_TAXONOMY = [
    {
        "id": "organization_and_context",
        "label": "SAL and Manual Context",
        "description": "SAL's mission, foundational learning context, program purpose and intended users.",
        "child_topics": ["organization_and_context"],
    },
    {
        "id": "library_foundations_and_roles",
        "label": "Library Foundations and Teacher Librarian Role",
        "description": "Why libraries matter and the responsibilities, skills and safeguarding awareness of teacher librarians.",
        "child_topics": ["library_foundations", "teacher_librarian_role"],
    },
    {
        "id": "library_management",
        "label": "Practical Library Management",
        "description": "Setting up, organizing and operating a safe, accessible and accountable school library.",
        "child_topics": [
            "library_operations", "library_space", "book_organization", "book_inventory",
            "circulation_and_book_selection", "library_routines", "library_rules",
            "records_and_reporting", "book_care_and_repair",
        ],
    },
    {
        "id": "literacy_activities",
        "label": "Reading and Literacy Activities",
        "description": "Principles and step-by-step guides for learner-centered reading activities.",
        "child_topics": [
            "reading_activities", "activity_facilitation", "life_skills_and_values",
            "read_aloud", "storytelling", "spelling_bee", "debate",
            "dramatization_and_role_play", "story_building", "anagram_word_building",
            "book_clubs", "sal_programs",
        ],
    },
    {
        "id": "reading_culture_and_engagement",
        "label": "Reading Culture and Stakeholder Engagement",
        "description": "Whole-school reading culture, learner leadership, parents, partners and literacy events.",
        "child_topics": [
            "reading_culture", "school_leadership", "teacher_engagement",
            "learner_leadership", "reading_events", "parental_engagement",
            "community_partnerships", "reading_culture_challenges",
        ],
    },
    {
        "id": "monitoring_and_sustainability",
        "label": "Monitoring, Reporting and Sustainability",
        "description": "Indicators, records, reporting, continuous improvement and long-term school ownership.",
        "child_topics": [
            "monitoring_and_evaluation", "monitoring_indicators",
            "program_sustainability", "record_templates", "learner_reading_records",
            "session_plans",
        ],
    },
    {
        "id": "reference_materials",
        "label": "Reference Posters, Pledges and Safeguarding",
        "description": "Ready-to-use posters, reading pledges and child safeguarding reminders.",
        "child_topics": ["library_posters", "reading_pledge", "child_safeguarding"],
    },
]


def normalize_line(line: str) -> str:
    line = line.replace("\u00ad", "").replace("\xa0", " ")
    line = re.sub(r"[ \t]+", " ", line).strip()
    return line


def extract_lines() -> list[dict]:
    reader = PdfReader(str(SOURCE_PDF))
    lines: list[dict] = []
    for page_number, page in enumerate(reader.pages, 1):
        for raw_line in (page.extract_text() or "").splitlines():
            line = normalize_line(raw_line)
            if not line:
                continue
            if re.fullmatch(r"\d+\s*\|\s*Start A Library Trust \(SAL\)", line):
                continue
            if line == "Table of Contents" or "...." in line:
                continue
            lines.append({"page": page_number, "text": line})
    return lines


def find_heading_positions(lines: list[dict]) -> list[tuple[int, Heading]]:
    positions: list[tuple[int, Heading]] = []
    cursor = 0
    for heading in HEADINGS:
        found = None
        for index in range(cursor, len(lines)):
            if lines[index]["text"].startswith(heading.match):
                found = index
                break
        if found is None:
            raise RuntimeError(f"Could not find heading: {heading.match}")
        positions.append((found, heading))
        cursor = found + 1
    return positions


def join_lines(section_lines: list[dict]) -> str:
    paragraphs: list[str] = []
    current = ""
    bullet_prefixes = ("•", "❖", "✓", "✔", "◊", "-", "­", "➢")
    for item in section_lines:
        line = item["text"]
        if line.startswith(bullet_prefixes) or re.match(r"^[a-z]\)\s", line) or re.match(r"^\d+\.\s", line):
            if current:
                paragraphs.append(current)
                current = ""
            paragraphs.append(line)
            continue
        if current and current.endswith((".", ":", "?", "!", ";")):
            paragraphs.append(current)
            current = line
        else:
            current = f"{current} {line}".strip()
    if current:
        paragraphs.append(current)
    text = "\n".join(paragraphs)
    text = re.sub(r"\s+([,.;:?!])", r"\1", text)
    return text.strip()


def split_text(text: str, max_words: int = 650, overlap_words: int = 70) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [text]
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + max_words, len(words))
        if end < len(words):
            sentence_end = None
            for index in range(end, max(start + max_words - 100, start), -1):
                if words[index - 1].endswith((".", "?", "!")):
                    sentence_end = index
                    break
            if sentence_end:
                end = sentence_end
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start = max(end - overlap_words, start + 1)
    return chunks


def make_chunk(section: dict, text: str, part: int, part_count: int) -> dict:
    stable_key = f"{section['section']}|{section['page_start']}|{part}|{text[:120]}"
    chunk_id = "sal-" + hashlib.sha1(stable_key.encode("utf-8")).hexdigest()[:12]
    title = section["title"]
    if part_count > 1:
        title = f"{title} (Part {part} of {part_count})"
    return {
        "id": chunk_id,
        "document_id": "sal-teacher-librarian-guide",
        "source_title": SOURCE_NAME,
        "source_organization": SOURCE_ORGANIZATION,
        "source_file": SOURCE_PDF.name,
        "title": title,
        "chapter": section["chapter"],
        "section": section["section"],
        "topic": section["topic"],
        "tags": section["tags"],
        "content_type": section["content_type"],
        "language": section.get("language", "en"),
        "page_start": section["page_start"],
        "page_end": section["page_end"],
        "chunk_part": part,
        "chunk_part_count": part_count,
        "word_count": len(text.split()),
        "char_count": len(text),
        "extraction_method": section.get("extraction_method", "embedded_pdf_text"),
        "text": text,
    }


def build_sections(lines: list[dict]) -> list[dict]:
    positions = find_heading_positions(lines)
    sections = []
    for position_index, (start, heading) in enumerate(positions):
        end = positions[position_index + 1][0] if position_index + 1 < len(positions) else len(lines)
        section_lines = lines[start:end]
        for trim_index, item in enumerate(section_lines[1:], 1):
            normalized = item["text"].lower()
            starts_new_page = item["page"] > section_lines[0]["page"]
            if (
                starts_new_page
                and normalized in {"learning objectives", "learning objective", "appendix"}
            ):
                section_lines = section_lines[:trim_index]
                break
        page_start = section_lines[0]["page"]
        page_end = section_lines[-1]["page"]
        text = join_lines(section_lines)
        sections.append(
            {
                "title": heading.title,
                "chapter": heading.chapter,
                "section": heading.section,
                "topic": heading.topic,
                "tags": list(heading.tags),
                "content_type": heading.content_type,
                "page_start": page_start,
                "page_end": page_end,
                "text": text,
                "extraction_method": "embedded_pdf_text",
            }
        )

    # The final embedded-text section includes image-only appendix headings without
    # searchable body text. Replace that tail with reviewed image transcriptions.
    sections[-1]["text"] = sections[-1]["text"].split("Appendix 8: Word wall posters", 1)[0].strip()
    sections[-1]["page_end"] = 39
    sections.extend(
        {
            **section,
            "extraction_method": "reviewed_manual_transcription",
        }
        for section in LEARNING_OBJECTIVE_SECTIONS
    )
    sections.extend(
        {
            **section,
            "extraction_method": "manual_image_transcription",
        }
        for section in IMAGE_SECTIONS
    )
    return sections


def write_outputs(sections: list[dict]) -> list[dict]:
    chunks = []
    for section in sections:
        text_parts = split_text(section["text"])
        for part_number, text_part in enumerate(text_parts, 1):
            chunks.append(make_chunk(section, text_part, part_number, len(text_parts)))

    jsonl_path = OUTPUT_DIR / "sal-guide-chunks.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as file:
        for chunk in chunks:
            file.write(json.dumps(chunk, ensure_ascii=False) + "\n")

    csv_path = OUTPUT_DIR / "sal-guide-chunks.csv"
    csv_fields = [
        "id", "document_id", "title", "chapter", "section", "topic", "tags",
        "content_type", "language", "page_start", "page_end", "chunk_part",
        "chunk_part_count", "word_count", "char_count", "extraction_method", "text",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=csv_fields)
        writer.writeheader()
        for chunk in chunks:
            row = {field: chunk[field] for field in csv_fields}
            row["tags"] = " | ".join(row["tags"])
            writer.writerow(row)

    taxonomy_path = OUTPUT_DIR / "sal-topic-taxonomy.json"
    taxonomy_path.write_text(
        json.dumps(
            {
                "document_id": "sal-teacher-librarian-guide",
                "source_title": SOURCE_NAME,
                "top_level_topics": TOPIC_TAXONOMY,
                "leaf_topics": sorted({chunk["topic"] for chunk in chunks}),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    summary = {
        "document_id": "sal-teacher-librarian-guide",
        "source_file": SOURCE_PDF.name,
        "pdf_pages": len(PdfReader(str(SOURCE_PDF)).pages),
        "semantic_sections": len(sections),
        "chunks": len(chunks),
        "max_chunk_words": max(chunk["word_count"] for chunk in chunks),
        "average_chunk_words": round(sum(chunk["word_count"] for chunk in chunks) / len(chunks), 1),
        "languages": sorted({chunk["language"] for chunk in chunks}),
        "topics": sorted({chunk["topic"] for chunk in chunks}),
        "image_transcription_chunks": sum(
            chunk["extraction_method"] == "manual_image_transcription" for chunk in chunks
        ),
    }
    (OUTPUT_DIR / "sal-ingestion-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return chunks


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = extract_lines()
    sections = build_sections(lines)
    chunks = write_outputs(sections)
    print(f"Created {len(chunks)} chunks from {len(sections)} semantic sections.")
    print(f"Output directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
