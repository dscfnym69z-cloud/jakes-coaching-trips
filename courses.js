// courses.js
// Fixed course data for Costa Ballena Ocean Golf Club, Rota (Cádiz, Spain).
// Par / stroke-index figures taken from the club's published scorecards.

// Individual stableford rounds are always played on the 9-hole Par 3 course.
const PAR3_COURSE = {
  name: 'Costa Ballena Par 3 Course',
  holes: [
    { number: 1, par: 3, si: 7 },
    { number: 2, par: 3, si: 11 },
    { number: 3, par: 3, si: 15 },
    { number: 4, par: 3, si: 13 },
    { number: 5, par: 3, si: 17 },
    { number: 6, par: 3, si: 1 },
    { number: 7, par: 3, si: 9 },
    { number: 8, par: 3, si: 5 },
    { number: 9, par: 3, si: 3 },
  ],
};

// The 27-hole championship course is three 9-hole loops (Olivos, Palmeras, Ficus)
// combined into three official 18-hole routings.
const OLIVOS = [
  { par: 4, si: 7 }, { par: 3, si: 9 }, { par: 4, si: 17 }, { par: 4, si: 3 }, { par: 5, si: 5 },
  { par: 3, si: 13 }, { par: 4, si: 1 }, { par: 5, si: 11 }, { par: 4, si: 15 },
];
const PALMERAS = [
  { par: 5, si: 12 }, { par: 4, si: 6 }, { par: 5, si: 8 }, { par: 4, si: 4 }, { par: 3, si: 10 },
  { par: 4, si: 18 }, { par: 3, si: 14 }, { par: 4, si: 16 }, { par: 4, si: 2 },
];
// Ficus's published stroke-index assignment depends on which nine it's paired with.
const FICUS_AFTER_PALMERAS = [
  { par: 4, si: 7 }, { par: 3, si: 11 }, { par: 5, si: 3 }, { par: 3, si: 1 }, { par: 4, si: 15 },
  { par: 4, si: 13 }, { par: 3, si: 17 }, { par: 4, si: 5 }, { par: 4, si: 9 },
];
const FICUS_BEFORE_OLIVOS = [
  { par: 4, si: 8 }, { par: 3, si: 12 }, { par: 5, si: 4 }, { par: 3, si: 2 }, { par: 4, si: 16 },
  { par: 4, si: 14 }, { par: 3, si: 18 }, { par: 4, si: 6 }, { par: 4, si: 10 },
];

function buildCourse(name, front, back) {
  return { name, holes: [...front, ...back].map((h, i) => ({ number: i + 1, par: h.par, si: h.si })) };
}

const MATCH_COURSES = {
  olivosPalmeras: buildCourse('Olivos + Palmeras', OLIVOS, PALMERAS),
  palmerasFicus: buildCourse('Palmeras + Ficus', PALMERAS, FICUS_AFTER_PALMERAS),
  ficusOlivos: buildCourse('Ficus + Olivos', FICUS_BEFORE_OLIVOS, OLIVOS),
};
const DEFAULT_MATCH_COURSE_KEY = 'olivosPalmeras';

module.exports = { PAR3_COURSE, MATCH_COURSES, DEFAULT_MATCH_COURSE_KEY };
