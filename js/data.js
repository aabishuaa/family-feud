// ============================================================
// data.js — Family Feud Game Data
// Add or edit questions/answers/points here.
// Each round has a question and up to 8 answers (sorted by points, high→low).
// roundMultipliers: [1, 2, 3] — points × multiplier per round.
// ============================================================

const GAME_DATA = {
  settings: {
    maxStrikes: 3,
    totalRounds: 3,
    roundMultipliers: [1, 2, 3],
    fastMoneyTarget: 200,
    fastMoneyTimeP1: 20,
    fastMoneyTimeP2: 25,
  },

  // ── MAIN GAME ROUNDS ──────────────────────────────────────
  // Answers must be sorted highest points first.
  rounds: [
    {
      id: 1,
      question: "We surveyed 100 people. Name something you find in a doctor's office.",
      answers: [
        { id: 1, text: "Waiting Room / Chairs", points: 42 },
        { id: 2, text: "Magazines / Books",     points: 28 },
        { id: 3, text: "Nurses / Doctors",       points: 15 },
        { id: 4, text: "Medical Equipment",      points: 8  },
        { id: 5, text: "Exam Table",             points: 5  },
        { id: 6, text: "Prescriptions",          points: 2  },
      ],
    },
    {
      id: 2,
      question: "We surveyed 100 people. Name something people do at the beach.",
      answers: [
        { id: 1, text: "Swim / Wade",        points: 45 },
        { id: 2, text: "Build Sandcastles",  points: 22 },
        { id: 3, text: "Sunbathe / Tan",     points: 18 },
        { id: 4, text: "Play Volleyball",    points: 8  },
        { id: 5, text: "Collect Shells",     points: 5  },
        { id: 6, text: "Eat / Grill Food",   points: 2  },
      ],
    },
    {
      id: 3,
      question: "We surveyed 100 people. Name a popular pizza topping.",
      answers: [
        { id: 1, text: "Pepperoni",       points: 45 },
        { id: 2, text: "Extra Cheese",    points: 25 },
        { id: 3, text: "Mushrooms",       points: 12 },
        { id: 4, text: "Sausage",         points: 10 },
        { id: 5, text: "Bell Peppers",    points: 5  },
        { id: 6, text: "Olives",          points: 3  },
      ],
    },
    {
      id: 4,
      question: "We surveyed 100 people. Name something people lose most often.",
      answers: [
        { id: 1, text: "Keys",              points: 42 },
        { id: 2, text: "Phone",             points: 28 },
        { id: 3, text: "Wallet / Purse",    points: 18 },
        { id: 4, text: "Glasses",           points: 8  },
        { id: 5, text: "Remote Control",    points: 4  },
      ],
    },
    {
      id: 5,
      question: "We surveyed 100 people. Name something you do on a Sunday morning.",
      answers: [
        { id: 1, text: "Sleep In / Rest",        points: 38 },
        { id: 2, text: "Watch TV / Sports",      points: 22 },
        { id: 3, text: "Go to Church",           points: 18 },
        { id: 4, text: "Make Breakfast",         points: 12 },
        { id: 5, text: "Read Newspaper",         points: 6  },
        { id: 6, text: "Do Laundry / Chores",    points: 4  },
      ],
    },
    {
      id: 6,
      question: "We surveyed 100 people. Name something people do while watching TV.",
      answers: [
        { id: 1, text: "Eat Snacks",          points: 40 },
        { id: 2, text: "Scroll Phone",        points: 28 },
        { id: 3, text: "Fall Asleep",         points: 18 },
        { id: 4, text: "Fold Laundry",        points: 8  },
        { id: 5, text: "Exercise / Workout",  points: 6  },
      ],
    },
    {
      id: 7,
      question: "We surveyed 100 people. Name an animal commonly kept as a pet.",
      answers: [
        { id: 1, text: "Dog",            points: 48 },
        { id: 2, text: "Cat",            points: 32 },
        { id: 3, text: "Fish",           points: 10 },
        { id: 4, text: "Bird / Parrot",  points: 6  },
        { id: 5, text: "Rabbit",         points: 4  },
      ],
    },
    {
      id: 8,
      question: "We surveyed 100 people. Name something you find at the gym.",
      answers: [
        { id: 1, text: "Weights / Dumbbells",  points: 42 },
        { id: 2, text: "Treadmill / Machines", points: 30 },
        { id: 3, text: "Lockers / Showers",    points: 14 },
        { id: 4, text: "Mirrors",              points: 8  },
        { id: 5, text: "Towels / Sweat",       points: 6  },
      ],
    },
    {
      id: 9,
      question: "We surveyed 100 people. Name something you might find under a bed.",
      answers: [
        { id: 1, text: "Dust / Dust Bunnies",  points: 38 },
        { id: 2, text: "Shoes / Socks",        points: 28 },
        { id: 3, text: "Toys / Games",         points: 18 },
        { id: 4, text: "Books / Magazines",    points: 10 },
        { id: 5, text: "Money / Change",       points: 6  },
      ],
    },
    {
      id: 10,
      question: "We surveyed 100 people. Name a reason people call in sick to work.",
      answers: [
        { id: 1, text: "Actually Sick / Flu",  points: 45 },
        { id: 2, text: "Need a Mental Day",    points: 25 },
        { id: 3, text: "Family Issue",         points: 15 },
        { id: 4, text: "Hangover",             points: 10 },
        { id: 5, text: "Bad Weather",          points: 5  },
      ],
    },
    {
      id: 11,
      question: "We surveyed 100 people. Name something you order at a fast food restaurant.",
      answers: [
        { id: 1, text: "Burger / Sandwich",  points: 42 },
        { id: 2, text: "French Fries",       points: 30 },
        { id: 3, text: "Soda / Drink",       points: 15 },
        { id: 4, text: "Chicken",            points: 8  },
        { id: 5, text: "Salad",              points: 5  },
      ],
    },
    {
      id: 12,
      question: "We surveyed 100 people. Name something people do to celebrate a birthday.",
      answers: [
        { id: 1, text: "Eat Cake",            points: 40 },
        { id: 2, text: "Go Out to Dinner",    points: 28 },
        { id: 3, text: "Throw a Party",       points: 18 },
        { id: 4, text: "Open Presents",       points: 10 },
        { id: 5, text: "Go to a Bar",         points: 4  },
      ],
    },
  ],

  // ── FAST MONEY ROUNDS ─────────────────────────────────────
  // The host reads each question; players give one answer each.
  // answers are sorted high→low so the host can grade responses.
  fastMoneyRounds: [
    {
      questions: [
        {
          question: "Name something you do first thing in the morning.",
          answers: [
            { text: "Brush Teeth",    points: 34 },
            { text: "Check Phone",    points: 28 },
            { text: "Make Coffee",    points: 22 },
            { text: "Shower",         points: 10 },
            { text: "Eat Breakfast",  points: 6  },
          ],
        },
        {
          question: "Name a sport that starts with the letter B.",
          answers: [
            { text: "Basketball",  points: 38 },
            { text: "Baseball",    points: 30 },
            { text: "Boxing",      points: 20 },
            { text: "Bowling",     points: 10 },
            { text: "Badminton",   points: 2  },
          ],
        },
        {
          question: "Name something you find in a kitchen.",
          answers: [
            { text: "Refrigerator",       points: 32 },
            { text: "Stove / Oven",       points: 28 },
            { text: "Sink",               points: 22 },
            { text: "Dishes / Plates",    points: 12 },
            { text: "Microwave",          points: 6  },
          ],
        },
        {
          question: "Name something people do at a party.",
          answers: [
            { text: "Dance",          points: 40 },
            { text: "Eat / Drink",    points: 28 },
            { text: "Socialize",      points: 18 },
            { text: "Play Games",     points: 10 },
            { text: "Take Photos",    points: 4  },
          ],
        },
        {
          question: "Name something associated with summer.",
          answers: [
            { text: "Beach / Pool",   points: 38 },
            { text: "Heat / Sun",     points: 30 },
            { text: "Ice Cream",      points: 18 },
            { text: "Vacation",       points: 10 },
            { text: "BBQ / Cookout",  points: 4  },
          ],
        },
      ],
    },
  ],
};
