/**
 * product_types.js — THE editable rule file for product types.
 *
 * How matching works (see classify_types.js):
 *   - The product name is lower-cased. Patterns are JavaScript regular expressions written as
 *     strings and matched anywhere in the name (Georgian stems, so "საფენ" matches საფენი/საფენები).
 *   - RULES are tried top to bottom; the FIRST rule that matches decides the type. Put specific
 *     rules above general ones (e.g. "wet wipes" above "napkins", "dishwasher" above "dish liquid").
 *   - A rule matches when:  any  — at least one pattern matches (if given)
 *                           all  — every group has at least one matching pattern (if given)
 *                           not  — no pattern matches
 *                           sub  — subcategory id is in the list (if given)
 *                           unit — volume unit is one of: "liquid" (ლ/მლ), "mass" (კგ/გ), "count" (ც)
 *                                  (taken from the volume column, else from a size written in the name)
 *                           ml   — [min, max] size in millilitres (liquids only)
 *   - JS "\b" does not see Georgian letters as word characters, so use B (Georgian word start)
 *     and E (Georgian word end) around short stems. Example: B + "ტრუს" matches ტრუსი (pull-ups)
 *     but not ციტრუსი (citrus).
 *   - type "other" in a rule forces "other" (used to stop look-alikes, e.g. toilet brushes).
 *   - Names are full of shop abbreviations: შამპ. = shampoo, კბ/პას = toothpaste, ტ/ქ = toilet
 *     paper, საპ. = soap, სვ. ხელ. = wet wipes, ბავ. = baby. Keep those patterns when editing.
 *
 * TYPES with extra: true are NOT in the requested list; they were added because the dazoge
 * hygiene category contains large groups (hair dye, nail polish, makeup, tights...) that would
 * otherwise sit in "other". Delete a type's rules to fold it back into "other".
 */

const B = "(?<![\\u10D0-\\u10FF])"; // start of a Georgian word
const E = "(?![\\u10D0-\\u10FF])"; // end of a Georgian word

const TYPES = [
  // ── requested list ──
  { id: "laundry_powder", label: "laundry powder" },
  { id: "laundry_liquid", label: "laundry liquid/gel" },
  { id: "laundry_capsules", label: "laundry capsules" },
  { id: "fabric_softener", label: "fabric softener" },
  { id: "laundry_additives", label: "laundry additives (stain remover, machine cleaner, water softener, colour catcher)" },
  { id: "bleach", label: "bleach" },
  { id: "dish_liquid", label: "dish liquid" },
  { id: "dishwasher_tablets", label: "dishwasher tablets/capsules" },
  { id: "dishwasher_salt_rinse", label: "dishwasher salt/rinse aid" },
  { id: "universal_cleaner", label: "universal/surface cleaner" },
  { id: "cream_cleaner", label: "cream cleaner" },
  { id: "kitchen_degreaser", label: "kitchen/degreaser spray" },
  { id: "bathroom_cleaner", label: "bathroom cleaner" },
  { id: "glass_cleaner", label: "glass cleaner" },
  { id: "toilet_cleaner", label: "toilet cleaner" },
  { id: "toilet_block", label: "toilet block" },
  { id: "floor_cleaner", label: "floor cleaner" },
  { id: "air_freshener", label: "air freshener" },
  { id: "toilet_paper", label: "toilet paper" },
  { id: "paper_towels", label: "paper towels" },
  { id: "napkins", label: "napkins" },
  { id: "tissues", label: "tissues" },
  { id: "wet_wipes_baby", label: "wet wipes (baby)" },
  { id: "wet_wipes_other", label: "wet wipes (other)" },
  { id: "shampoo", label: "shampoo" },
  { id: "conditioner", label: "conditioner" },
  { id: "hair_care_unclear", label: "hair care (unclear)" },
  { id: "shower_gel", label: "shower gel" },
  { id: "bar_soap", label: "bar soap" },
  { id: "liquid_soap", label: "liquid soap" },
  { id: "toothpaste", label: "toothpaste" },
  { id: "toothbrush", label: "toothbrush" },
  { id: "mouthwash", label: "mouthwash" },
  { id: "deodorant", label: "deodorant" },
  { id: "razor_shaving", label: "razor/shaving" },
  { id: "diapers", label: "diapers" },
  { id: "feminine_pads", label: "feminine pads/liners" },
  { id: "tampons", label: "tampons" },
  { id: "cotton_buds", label: "cotton buds" },
  { id: "cotton_pads", label: "cotton pads" },
  { id: "hand_body_cream", label: "hand/body cream" },
  { id: "sponges", label: "sponges" },
  { id: "cloths", label: "cloths" },
  { id: "cleaning_brushes", label: "cleaning brushes" },
  { id: "gloves", label: "gloves" },
  { id: "trash_bags", label: "trash bags" },
  { id: "foil_film", label: "foil/cling film/baking paper" },
  { id: "disposable_tableware", label: "disposable tableware" },
  // ── extra (not in the requested list) ──
  { id: "hair_dye", label: "hair dye", extra: true },
  { id: "nail_care", label: "nail polish, nail care & tweezers", extra: true },
  { id: "makeup", label: "makeup", extra: true },
  { id: "perfume", label: "perfume / body spray", extra: true },
  { id: "face_care", label: "face & lip care", extra: true },
  { id: "hair_styling", label: "hair styling", extra: true },
  { id: "hosiery", label: "tights / socks", extra: true },
  { id: "hair_accessories", label: "combs & hair accessories", extra: true },
  { id: "insecticide", label: "insect repellent / insecticide", extra: true },
  { id: "shoe_care", label: "shoe & leather care", extra: true },
  // ── fallback ──
  { id: "other", label: "other" },
];

const CLEAN = "საწმენდ|გამწმენდ|სპრეი|სითხ|საშუალებ|საშ\\.|გელ|ქაფ|ფხვნილ|კრემ|მოსაშორ|საწ\\.";
const BABY = "ბავშვ|საბავშ|ბავ\\.|ბავ" + E + "|ბეიბი|baby|ჩვილ|პამპერს|ჰაგის|huggies|pampers|ახალშობ|0\\+";
const WIPE = "ხელსახ|ხელ\\.|ხელ" + E + "|ტილო|ქაღალდ|საწმენდ|სალფეთ";
const LAUNDRY = "სარეცხ|რეცხვ|ავტომატ|ქსოვილ|ფერად|თეთრ|არიელ|ariel|პერსილ|persil|ტაიდ|tide|ბინგო|bingo|ბიმაქს|bimax|ლოსკ|losk|მიფ" + E + "|myth|ტაიდ";
const ORAL_BRANDS = "ქოლგეით|colgate|ორალ\\s*-?\\s*ბი|ორალბი|oral\\s*-?\\s*b|ბლენდ|blend-a|სპლატ|splat|პაროდონტ|parodont|სენსოდ|sensod|thera\\s*med|ლაკალუტ|lacalut|აქვაფრეშ|aquafresh|პრეზიდენტ|president|სიგნალ|signal|ნ[ეი]ვსკაია ზუბ";

const RULES = [
  // ───────── look-alikes that must not reach a household type ─────────
  { type: "cleaning_brushes", why: "toilet / dish / bottle / floor brushes, brooms, dustpans, brush handles", any: ["(უნიტაზის|ტუალეტის|ჭურჭლის|ბოთლის|იატაკის)\\s+(საწმენდი\\s+)?ჯაგრის", "ჯაგრისი\\s+(ჭურჭლ|უნიტაზ)", "ჯაგრისის ჯოხ", "flora ჯაგრის", "ცოცხ", "აქანდაზ"] },
  { type: "cleaning_brushes", sub: [101, 102, 106, 108], any: ["ჯაგრის", "ჯაგარ"], not: ["კბილ", "თმის", "ფეხსაცმ", "ტანის", "ტანსაცმ", "ფუნჯ", "სავარცხ"] },
  { type: "other", why: "lint rollers, clothes pegs, hangers", any: ["გორგოლაჭ", "სარეცხის სამაგრ", B + "საკიდ", "ტანსაცმლის ლილვაკ", "ლილვაკ"] },
  { type: "laundry_additives", why: "washing-machine descaler/cleaner, water softener, colour-catcher sheets", any: ["კალგონ", "calgon", "სარეცხი მანქანის", "სარეცხი ხელსახოც", "ფერის (დამჭერ|შთანთქ)", "colou?r ?catch", "წყლის (რბილ|დამარბილ)"], not: ["ჭურჭ", "ტილო"] },
  { type: "other", why: "grill lighter fluid / charcoal", any: ["ცეცხლის ასან", "ასანთებ", "ნახშირი" + E], not: ["კბილ", "ჯაგრის"] },
  { type: "other", why: "glue", any: [B + "წებო"] },

  // ───────── extras that share words with listed types (must run early) ─────────
  { type: "nail_care", any: ["ფრჩხილ", "მანიკიურ", "პედიკიურ", "აცეტონ", "nail", "ქლიბ", B + "ნუნ", "საკვნეტელ", "თითების გამყოფ", "პინცეტ", "ლაქის მოსაც", "ლაქის მოსაშ"], not: ["ფეხის კრემ"] },
  { type: "nail_care", sub: [104, 105], any: ["ლაქი" + E, "ლაქ\\."], not: ["თმის", "ლაქებ"] },
  { type: "hosiery", any: ["კოლგოტ", "კოლოტ", "წინდ", "ლეგინს", "კაპრონ", "ჩულქ", "გეტრ", "\\d+\\s*დენ" + E] },
  { type: "hair_dye", sub: [100, 104, 105], any: ["საღებავ", "საღ\\.", "საღ" + E, "ოქსიდ", "გამაღიავებ", "ტონირ", "თმის ფერ", "თმის ტონიკ", "ტონიკა", "tonica", "tonika"] },
  { type: "hair_dye", sub: [104], any: ["კოლორ" + E, "color naturals", "კოლორ ნატურალ"], not: ["შამპუნ", "ბალზამ", "nail", "პომად", "riche"] },
  { type: "air_freshener", why: "car perfume is an air freshener", any: ["მანქანის (სუნამ|სურნელ|არომატ)", "ავტომობილის (სუნამ|სურნელ|არომატ)", "areon", "არეონ"] },
  { type: "perfume", sub: [100, 104, 105], any: ["სუნამო", "ტუალეტის წყალ", "პარფიუმ", "ოდეკოლონ", "eau de", "სხეულის სპრეი", "ტანის სპრეი", "ბოდი მისტ", "shaik", "შეიკ", "jean mar", "ჯინ მარკ", "ხუან მარკ"] },
  { type: "insecticide", any: ["მწერ", "კოღო", "ტარაკან", B + "ბუზ", "რეიდ", "raid", "ფუმიტოქს", "ინსექტ", "ჩრჩილ", "ტკიპ", "ჭიანჭველ"] },
  { type: "shoe_care", any: ["ფეხსაცმლ", "ზამშ", "ნუბუკ", "ტყავის"] },

  // ───────── wipes & paper ─────────
  { type: "wet_wipes_baby", all: [["სველ", B + "სვ\\.", "წყლის ხელსახოც", "water wipes"], [BABY]] },
  { type: "wet_wipes_baby", all: [["ხელსახ", "სალფეთ"], [BABY]], not: ["მშრალ", "ცხვირსახოც"] },
  { type: "wet_wipes_baby", sub: [100], any: ["ხელსახოც", "სველ", "დაიპერ"], not: ["ცხვირსახოც", "მშრალ"] },
  { type: "wet_wipes_other", all: [["სველ", B + "სვ\\."], [WIPE]] },
  { type: "wet_wipes_other", any: ["wet wipes", "ინტიმური ხელსახოც", "ანტიბაქტერიული ხელსახოც", "სველი სალფეთ"] },
  { type: "toilet_paper", any: ["ტ[უ]?ალეტის ქაღ", "საპირფარეშოს ქაღალდ", "toilet paper", "ტუალ\\.? ქაღ", B + "ტ\\s*/\\s*ქ" + E, "\\d\\s*ply", "\\brolls\\b"] },
  { type: "tissues", sub: [106], any: ["სახის საწმენდ"] },
  { type: "tissues", any: ["ც[ხ]?ვირსახოც", "სახის ხელსახოც", "კოსმეტიკური ხელსახოც", "ჯიბის ხელსახოც", "ხელსახოცი ყუთ", "ყუთში"], not: ["სველ"] },
  { type: "paper_towels", any: ["ქაღალდის პირსახოც", "ქაღალდის ტილო", "სამზარეულოს ქაღალდ", "სამზ\\.?\\s*ქაღ", "სამზარ\\S*\\s+პირსახოც", "ქაღალდის ხელსახოცი რულონ", "სამზარეულოს ხელსახოც.*(როლ|რულონ)"] },
  { type: "paper_towels", sub: [105, 106], any: ["პირსახოც"], not: ["მიკროფიბრ", "ვისკოზ", "ბამბის პირსახოც"] },
  { type: "paper_towels", sub: [106], all: [["სამზარეულ", "რულონ"], ["ქაღალდ", "\\d\\s*-?\\s*ფენ", "ფენიან", "რულონ"]], not: ["მიკროფიბრ", "ვისკოზ", "საწმენდი ტილო", "ჩვარ"] },
  { type: "napkins", any: ["ხელსახოც", "ხელასხოც", "ხელსახ" + E, "სუფრის", "სერვეტ", "მაგიდის ხელსახოც"], not: ["სველ", "ცხვირსახოც"] },

  // ───────── cotton & hygiene ─────────
  { type: "tampons", any: ["ტამპონ", "tampon"] },
  { type: "feminine_pads", any: ["უროლოგ", "tena lady", "ტენა ლე[ი]?დ"], not: [B + "ტრუს", "მწოლიარ"] },
  { type: "diapers", any: ["მწოლიარ", "ჰაგის", "huggies", "პამპერს", "pampers", "ლიბერო", "libero", "ქანბებე", "კანბებე", "მოზრდილ", "დაიპერ"], not: ["სველ", "ხელსახ", "კრემ", "შამპ"] },
  { type: "diapers", all: [["საფენ", B + "ტრუს"], [BABY, "ზომა", "კგ", "ტენა", "tena", B + "ტრუს", "\\bxl\\b"]], not: ["ჰიგიენური საფენ", "ყოველდღიურ"] },
  { type: "diapers", sub: [100], any: ["საფენ", B + "ტრუს"] },
  { type: "feminine_pads", any: ["საფენ", "ყოველდღიური (საფენ|ბალიშ|ლაინერ)", "ჰიგიენური ბალიშ", "კოტექს", "kotex", "ოლვეის", "always", "ლიბრეს", "libresse", "ნატურელ", "naturella", "დისქრიტ", "discreet"] },
  { type: "cotton_buds", all: [["ჩხირ"], ["ბამბ", "ყურ", "კოსმეტ"]] },
  { type: "cotton_buds", sub: [105], any: ["ჩხირ"] },
  { type: "cotton_pads", any: ["ბამბის (დისკ|რგოლ|ბალიშ|მრგვალ|კოსმ|ბურთ|ფირფიტ)", "(კოსმეტიკური|კოსმ\\.?) (ბამბ|დისკ|ბალიშ|რგოლ)", "მაკიაჟის დისკ", "დისკ(ი|ებ)?" + E, "ბამბა" + E, "cotton", "ბამბა\\s*\\d", "მრგვალი ბამბ"] },

  // ───────── household items (before chemicals: "ჭურჭლის სარეცხი ღრუბელი" is a sponge) ─────────
  { type: "gloves", any: ["ხელთათმან"] },
  { type: "trash_bags", any: ["ნაგვ"] },
  { type: "foil_film", any: ["ფოლგ", "ცელოფან", "საკვების ფირ", "სტრეჩ", "პერგამენტ", "საცხობი ქაღალდ", "ცხობ", "საცხობ ფურცელ", "შესაფუთ", "ვაკუუმ", "zip", "ზიპ", "საკვების (შესანახ|შენახვ)", "შესანახი პარკ", "ალუმინის", "პაკეტ"] },
  { type: "other", why: "reusable ceramic/glass kitchenware listed under c/108", any: ["nava", "ნავა", "ქვის დაფარვ", "ოპალ", "opal", "pasabahce", "პასაბაჰჩე", "levori", "ლევორი", "lux plastic", "ლუქს პლასტიკ"], not: ["ერთჯერად", "ფოლგ", "ალუმინის", "ღრუბ", "ხელთათმან", "ნაგვ"] },
  // Disposable only: needs a disposable signal (ერთჯერადი / paper / plastic / pack of 5+). Reusable cups,
  // bowls and food containers that dazoge also lists under c/108 fall through to "other".
  { type: "disposable_tableware", sub: [102, 106, 108], any: ["ერთჯერად", "ქაღალდის (ჭიქ|თეფშ|თას)", "პლასტმასის (ჭიქ|თეფშ|კოვზ|ჩანგალ|დან)", "euro pac", "ევრო პაკ", "თერმული ჭიქ", "შამფურ", "საწრუპ", "კბილსაჩიჩქნ", "ჩხირ"], not: ["საპარს", "ხელთათმან", "ტილო", "კონვერტ", "ნაგვ", "ხელსახოც"] },
  { type: "disposable_tableware", sub: [102, 106, 108], all: [["ჭიქ", "თეფშ", "კოვზ", "ჩანგალ", "დანა" + E], ["(\\d{2,}|[5-9])\\s*-?\\s*(ც|ცალ)"]], not: ["ხორცის", "უჟანგავ", "ფოლად", "მინის"] },
  { type: "sponges", any: ["ღრუბ", "სახეხ", "ფოლადის", "მეტალის სახეხ", "spontex", "სპონტექს", "პემზ"] },
  { type: "sponges", sub: [102, 106, 108], any: ["სპონჯ"] },
  { type: "cloths", any: ["ტილო", "მიკროფიბრ", "ჩვარ", B + "მოპ", "ვილედა", "vileda", "ნაჭერ"], not: ["ბამბუკის ნაჭრ"] },

  // ───────── oral care ─────────
  { type: "toothpaste", any: ["კბილის პასტ", "პასტა" + E, "toothpaste", "კბ\\.?\\s*/?\\s*პას", "კბ\\.? პასტ"], not: ["ჯაგრის", "თმის"] },
  { type: "toothbrush", any: ["კბილის ჯაგრის", "კბ\\.?\\s*ჯაგრის", "კბილის ძაფ", "კბილთაშორის", "toothbrush"] },
  { type: "toothbrush", sub: [100, 104, 105], any: ["ჯაგრის", "ჯარგის"], not: ["თმის", "ფეხსაცმ", "ტანის", "ტანსაცმ", "სავარცხ"] },
  { type: "toothbrush", all: [[ORAL_BRANDS], ["ჯაგრის", "ჯარგის"]] },
  { type: "mouthwash", any: ["პირის ღრუს", "ღრუს სავლებ", "პირის სავლებ", "ლისტერინ", "listerine", "mouthwash", "პირის წყალ"] },
  { type: "toothpaste", any: ["კბილის", "მათეთრებელი კომპლექს"], not: ["ჯაგრის", "ძაფ"] },
  { type: "toothpaste", all: [[ORAL_BRANDS], ["\\d\\s*(მლ|ml|გრ?|g)" + E]], not: ["ჯაგრის", "სავლებ", "პირის ღრუს"] },

  // ───────── personal care ─────────
  { type: "deodorant", any: ["დეოდ", "დეოდირ", "დედოდ", "დეოდარ", "ანტიპერს", "ანტიპირს", "\\bdeo\\b", "დეო" + E, "დეოსპრ", "დეზ\\.", "დეზოდ", "დეზად", "რექსონ", "rexona", B + "აქსი" + E, "\\baxe\\b", "ბურთულიან", "ბურთ\\."] },
  { type: "razor_shaving", any: ["საპარს", "საპაარს", "გაპარსვ", "პარსვ", "ჯილეტ", "gillette", "სამართებ", "ბრიტვ", "დეპილ", "ეპილაც", "ცვილის ზოლ", "ცვილი" + E, "veet", "ვიტ" + E, "ბიკ" + E, "ტრიმერ", "ვენუს", "venus", "dorco", "დორკო", "ფუჟენ", "სათადარიგო პირ", B + "პირი" + E, "\\d\\s*პირ" + E] },
  { type: "face_care", any: ["ჰიგიენური ტუჩსაცხ", "ტუჩის ბალზამ", "ტუჩის კრემ", "მიც[ე]?[ლრ]ა[ლრ]", "მიცელ", "მციერალ", "ტონიკ", "ტონერ", "სერუმ", "შრატ", "პილინგ", "მაკიაჟის (მოსაშორ|მოსაცილ|ჩამოსაბ)", "მკიაჟის", "ნაოჭ", "თვალის ირგვლივ", "თვალის კრემ", "სახის", "სასხის", "დასაბანი (გელ|ქაფ)", "გამწმენდი (გელ|ქაფ|ნიღაბ)", "ნიღაბ", "თიხ", "რევიტალიფტ", "ჰიალურონ", "ჰიდროგელ", "გამაახალგაზრდავ", "ცხიმიანი კან", "მშრალი და მგრძნობიარე კან", "skin naturals", "ლიფთინგ"], not: ["თმის", "თმისთვის", "ტანის", "ხელის", "ფეხის", "პუდრ", "ტონალურ", "კონსილ", "ქონსილ", "ფანქარ"] },
  { type: "makeup", any: ["ტუში", "ტუჩსაცხ", "ტონალურ", "პუდრ", "ფანქარ", "ჩრდილ", "პალეტ", "კონსილერ", "ქონსილერ", "კორექტორ", "პრაიმერ", "ბრონზ", "ფერუმარილ", "რუმიან", "ლაინერ", "ბზინვ", "გლოს", "მაკიაჟ", "წარბ", "ტუჩის", "თვალის", "მასკარ", "mascara", "პომად", "lip ", "ჰაილა[ი]?თერ", "პერლამუტ", "ბაზა" + E, "სპონჯ"] },
  { type: "hair_styling", any: ["თმის ლაქ", "ლაქი თმ", "მუსი", "მუს" + E, "თმის გელ", "თმის ცვილ", "თმის ჟელ", "ფიქსაც", "სტაილინგ", "taft", "ტაფტ", "თმის სპრეი", "თმის პასტ", "got2b", "გოთთუბ", "wellaflex", "ველაფლექს"], not: ["შხაპ", "შამპ", "ტანის"] },
  { type: "shampoo", any: ["შამპ", "shampoo", "шампун"], not: ["მანქან", "ხალიჩ", "ავტო"] },
  { type: "conditioner", any: ["ბალზამ", "კონდ\\S*ციონ", "conditioner", "თმის ნიღაბ", "ნიღაბი თმ", "თმის ზეთ", "თმის შრატ", "თმის მოვლ"], not: ["ტუჩ", "ქსოვილ", "სარეცხ", "ჯაგრის", "სავარცხ", "სამაგრ", "რეზინ"] },
  { type: "shower_gel", any: ["შხაპ", "shower", "ტანის დასაბან", "აბაზანის ქაფ", "ქაფი აბაზან", "აბაზანის გელ", "გელი ტანის", "დუშ", "ინტიმური ჰიგიენის", "ინტიმ"], not: ["საწმენდ", "კაბინ", "ფარდ"] },
  { type: "hair_accessories", any: ["სავარცხელ", "სამაგრ", "ბიგუდ", "თმის ჯაგრის", "ფენის ჯაგრის", B + "რკალ", "თმის რეზინ", "შესაღები (ნაკრებ|ჯაგრის|ფუნჯ)"] },
  { type: "other", why: "hair dryers / appliances", sub: [104, 105], any: ["თმის ფენ", B + "ფენი" + E, "უთო", "სტაილერ"], not: ["ჯაგრის"] },
  // Hair masks, oils, leave-in creams and "გამ." (გამავლებელი) are kept with conditioner (approximate fit).
  { type: "conditioner", sub: [104], all: [["თმ"], ["ნიღაბ", "ზეთ", B + "გამ\\.", "გამავლებ", "კრემ"]], not: ["ჯაგრის", "სავარცხ", "სამაგრ", "რეზინ", "ტანის", "სახის"] },
  // Hair product with no type word: a 250–700 ml bottle is most likely shampoo; anything else stays unclear.
  { type: "shampoo", sub: [104], unit: ["liquid"], ml: [250, 700], any: ["თმისთვის", "თმის"], not: ["ჯაგრის", "სავარცხ", "სამაგრ", "რეზინ", "გელი", "ტანის"] },
  { type: "hair_care_unclear", sub: [104], any: ["თმისთვის", "თმის"], not: ["ჯაგრის", "სავარცხ", "სამაგრ", "რეზინ", "გელი", "ტანის"] },
  { type: "liquid_soap", all: [["თხევად"], ["საპონ", "საპ\\."]] },
  { type: "liquid_soap", any: ["თხევადი საპონ", "საპონი თხევად", "თხ\\.?\\s*საპ", "ხელის დასაბან", "ანტისეპტიკ", "ხელის გელ"] },
  { type: "bar_soap", any: ["საპონ", "საპ\\.", "საპ" + E, "soap", "мыло", "სეიფგარდ", "safeguard"], not: ["საპნის ბუშტ", "ბუშტ", "საწმენდ", "სითხ"] },
  { type: "hand_body_cream", sub: [100, 104, 105], any: ["ხელის კრემ", "ტანის კრემ", "ტანის ლოსიონ", "ტანის რძე", "სხეულის", "ტანის", "სკრაბ", "scrub", "ვაზელინ", "ფეხის", "მზისგან", "მზის დამცავ", "გარუჯვ", "კრემ", "კრ\\.?\\s*/?\\s*ხელ", "კრ\\.", "ლოსიონ", "ზეთი" + E, "პუდრა", "ტალკ", "საცხ", "ნელსაცხებ", "კარაქ", "ალოე ვერას გელ", "დამატენიანებელი გელ"] },

  // ───────── cookware is not disposable (placed after tableware/oral care so cups & brushes with lids survive) ─────────
  { type: "other", why: "cookware & kitchen tools, not disposable", any: [B + "ტაფა", B + "ტაფის", "ქვაბ", "ჯეზვე", "მაშებ", "საჭრელ", "მაკრატელ", "ლარნაკ", "თავსახურ"], not: ["ალუმინის ტაფ", "ერთჯერად", "ფოლგ", "ფრჩხილ", B + "ნუნ", "თმის", "სახეხ"] },

  // ───────── dishwashing ─────────
  { type: "dishwasher_salt_rinse", all: [["ჭურჭ", "მანქან", "ფინიშ", "finish", "სომატ", "somat"], ["მარილ", "გამავლებ", "სავლებ", "საპრიალებ", "rinse"]], not: ["ქსოვილ", "ლაქ"] },
  { type: "dishwasher_tablets", all: [["ჭურჭ", "ფინიშ", "finish", "სომატ", "somat", "fairy", "ფეირი"], ["ტაბლეტ", "კაფსულ", "ტაბ" + E, "აბ(ებ)?ი" + E, "all in one", "ყველა ერთში", "ფხვნილ", "platinum"]], not: ["ქსოვილ", "ტანსაცმ"] },
  { type: "dish_liquid", all: [["ჭურჭლ"], ["სარეცხ", "სითხ", "გელ", "საწმენდ", "საშ", "ჟელე"]], not: ["ღრუბ", "ტილო", "ხელთათმან", "მანქან"] },
  { type: "dish_liquid", any: ["ჭურჭლის (სარეცხ|სითხ|გელ|საწმენდ|საშ)", "ჭურჭლისთვის", "ფეირი", "fairy", "პრილ", "მეთ" + E, "აოს" + E], not: ["ღრუბ", "ტილო", "ხელთათმან"] },

  // ───────── laundry ─────────
  { type: "laundry_capsules", any: ["კაფსულ", "pods", "ფირფიტ"], sub: [101, 102], not: ["ლაქ", "მათეთრებ", "ჩრჩილ"] },
  { type: "laundry_liquid", any: ["ვერნელით", "lenor-ით", "ლენორით"], sub: [101, 102], not: ["ფხვნილ"] },
  { type: "fabric_softener", sub: [101, 102], any: ["დამარბილებ", "ანტისტატიკ", "ლენორ", "lenor", "ვერნელ", "vernel", "სილან", "კოკოლინ", "გამავლებ"] },
  { type: "fabric_softener", sub: [101], any: ["კონდიციონერ", "სავლებ"] },
  { type: "laundry_additives", why: "stain removers", any: ["ლაქების ამომყვანი ფირფიტ", "ლაქის ამომყვან", "ლაქების ამომყვან", "ლაქების მოსაშორ", "ლაქის ამოსაყვან", "ლაქების საწინააღმდ", "ვანიშ", "vanish", "ამომყვან", "ლაქის საწინააღმდ", "ლაქებისათვის", "oxy"] },
  // Bleach-type cleaners: every liquid Domestos (thick bleach / universal disinfectant) and anything that
  // says მათეთრებელი / ქლორი / სადეზინფექციო, wherever it is used. Rim blocks stay toilet blocks.
  { type: "bleach", why: "Domestos liquids", sub: [101, 102, 106, 108], any: ["დომესტოს", "domestos"], not: ["ჩასაკიდ", "ბლოკ", "ხელსახოც", "სველ"] },
  { type: "bleach", why: "bleach-type words", sub: [101, 102, 106, 108], any: ["მათეთრებ", "ბელიზნ", "ქლორ", "ჟაველ", "bleach", "სადეზინფ"], not: ["ჩასაკიდ", "ბლოკ", "ბრეფ", "bref", "ჭურჭ", "ხელსახოც", "სველ"] },
  { type: "bleach", sub: [101, 102], any: [B + "ეის", "\\bace\\b", "გათეთრებ", "სითეთრ"], not: ["უნიტაზ", "ჩასაკიდ", "ბრეფ", "bref", "აბაზან", "სამზარეულ", "იატაკ", "ჭურჭ"] },
  { type: "laundry_powder", any: ["ფხვნილ", "powder"], not: ["საწმენდი ფხვნილ", "სახეხი ფხვნილ"] },
  { type: "laundry_liquid", all: [["სარეცხ"], ["გელ", "თხევად", "სითხ", "კონცენტრ"]], not: ["ჭურჭ"] },
  { type: "laundry_liquid", sub: [101], any: ["თხევად", "გელ", "სითხ", "კონცენტრ"] },
  // Laundry with no form word: the unit decides (ლ/მლ = liquid/gel, კგ/გრ = powder); no unit → "other".
  { type: "laundry_liquid", sub: [101], unit: ["liquid"], any: [LAUNDRY] },
  { type: "laundry_powder", sub: [101], unit: ["mass"], any: [LAUNDRY, "\\d\\s*(კგ|kg)"] },
  { type: "laundry_powder", sub: [101], any: ["\\d([.,]\\d+)?\\s*(კგ|kg)"] },

  // ───────── cleaners ─────────
  { type: "air_freshener", any: ["ჰაერ", "არომატიზ", "გლეიდ", "glade", "ეარ ?ვიკ", "air wick", "airwick", "ოთახის სურნელ", "დიფუზორ", "სურნელოვანი ჩხირ", "არომატული ჩხირ", "ავტოარომატ", "aroma", "აეროზოლ", "სანთ[ე]?ლ.*არომატ"], not: ["ანტიბაქტ", "მწერ", "ავეჯ", "საპრიალებ", "ჩასაკიდ", "უნიტაზ"] },
  { type: "toilet_block", any: ["ჩასაკიდ", "უნიტაზის ბლოკ", "უნიტაზის არომატიზ", "ბლოკი" + E, "ტუალეტის ბლოკ", "ბრეფ", "bref", "სტიკერ", "ჩასაწებებ"] },
  { type: "toilet_block", sub: [102, 106], any: ["ჟელე"] },
  { type: "toilet_cleaner", any: ["უნიტაზ", "უნიტ\\.", "საპირფარეშ", "ტუალეტის საწმენდ", "ტუალეტის გელ", "დომესტოს", "domestos", "ჰარპიკ", "harpic", "ტუალეტ"] },
  { type: "glass_cleaner", all: [["მინ(ის|ებ|ისა)", "შუშ", "სარკ", "ფანჯრ", "glass"], [CLEAN, "კლინ", "clin"]] },
  { type: "bathroom_cleaner", all: [["აბაზან", "კრამიტ", "შხაპის კაბინ", "ონკან", "სანტექნ", "კაფელ"], [CLEAN]] },
  { type: "bathroom_cleaner", any: ["ნადებ", "ჟანგის", "სილიტ", "cillit", "მილების", "კირის", "ქვის მოსაშორ", "ქვის საწინააღ", "კალკ"] },
  { type: "kitchen_degreaser", any: ["ცხიმ(ის|ებ)", "შუმანიტ", "ანტიცხიმ", "ღუმელ", "გაზქურ", "მიკროტალღ"] },
  { type: "kitchen_degreaser", all: [["სამზარეულ", "ქურ" + E, "ქურის", "ცხიმ"], [CLEAN]] },
  { type: "floor_cleaner", any: ["იატაკ", "ლამინატ", "პარკეტ"] },
  { type: "cream_cleaner", sub: [102, 106, 108], any: ["საწმენდი კრემ", "კრემი" + E, "კრემ" + E, "პემოლუქს", "საწმენდი ფხვნილ", "საწმენდი რძე", "აბრაზიულ", "კომეტ"] },
  { type: "universal_cleaner", sub: [101, 102, 106, 108], any: ["უნივერსალ", "ზედაპირ", "მისტერ პროპერ", "mr\\.? proper", "საწმენდ", "გამწმენდ", "დეზინფექც", "ავეჯ", "საპრიალებ", "ანტიბაქტერ", "სპრეი", "საწ\\."], not: ["სავარცხ"] },

  // ───────── generic personal-care leftovers ─────────
  { type: "hair_accessories", any: ["სავარცხელ", "სამაგრ", "ბიგუდ", "თმის ჯაგრის", "ფენის ჯაგრის", "თმის"] },
  { type: "hair_accessories", sub: [100, 104, 105], any: ["რეზინ"] },
  { type: "hand_body_cream", sub: [100, 104, 105], any: ["გელი" + E, "დამატენიანებ", "მკვებავ"] },
];

/** Sub-detail labels: every matching label is kept, joined by "+". */
const DETAILS = {
  laundry: [
    ["color", "ფერად|კოლორ|color|ფერის"], ["white", "თეთრ|white|სითეთრ"], ["black", "შავ|მუქ|black"],
    ["delicate", "დელიკატ|მატყლ|აბრეშუმ|შალის|wool|silk"], ["baby", BABY],
    ["universal", "უნივერსალ"], ["hand-wash", "ხელით"], ["machine", "ავტომატ"],
  ],
  wipes: [
    ["baby", BABY], ["surface", "ზედაპირ|საწმენდ|სამზარეულ|იატაკ|მინის|ავეჯ|უნივერსალ|სახლის"],
    ["intimate", "ინტიმ"], ["makeup", "მაკიაჟ|მიცელ|სახის"], ["antibacterial", "ანტიბაქტ|ანტისეპტ"],
    ["toilet", "ტუალეტ"],
  ],
  additives: [
    ["stain remover", "ლაქ|vanish|ვანიშ|oxy|ამომყვან"], ["machine cleaner", "სარეცხი მანქანის|ნადებ"],
    ["water softener", "კალგონ|calgon|რბილ"], ["colour catcher", "სარეცხი ხელსახოც|ფერის (დამჭერ|შთანთქ)|colou?r ?catch"],
  ],
  soap: [["laundry", "სარეცხ|სამეურნეო|72%"]],
  diapers: [["adult", "მოზრდილ|ტენა|tena|მწოლიარ"], ["pants", B + "ტრუს|pants"], ["baby", BABY + "|ზომა"]],
  pads: [["urological", "უროლოგ|ტენა|tena"], ["liners", "ყოველდღიურ"], ["night", "ღამის"]],
};
const DETAIL_GROUPS = {
  laundry_powder: "laundry", laundry_liquid: "laundry", laundry_capsules: "laundry", fabric_softener: "laundry", laundry_additives: "additives", bleach: "laundry",
  wet_wipes_baby: "wipes", wet_wipes_other: "wipes",
  bar_soap: "soap", diapers: "diapers", feminine_pads: "pads",
};
const PAPER_TYPES = ["toilet_paper", "paper_towels", "napkins", "tissues"];

module.exports = { TYPES, RULES, DETAILS, DETAIL_GROUPS, PAPER_TYPES, B, E };
