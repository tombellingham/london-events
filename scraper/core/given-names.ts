/**
 * Common given names (lower-case), used only to sanity-check *position-based*
 * speaker guesses from titles ("Jane Doe: A Title"), where series names like
 * "Slow Looking: …" or "Digital Heists Uncovered: …" would otherwise pass as
 * people. Names found via honorifics ("Dr …") or "in conversation with …"
 * don't need this. Deliberately broad and international; a miss only means a
 * speaker isn't extracted from the title (structured sources are unaffected).
 */

const NAMES = `
aaron abby abdul abdullah abi abigail abraham ada adam adeel adele adeline adil aditi aditya adrian adriana adrienne afua agatha agnes ahmad ahmed aidan aileen aimee aisha akash akira al alan alana alastair albert alberto alec alejandra alejandro alessandra alessandro alessio alex alexa alexander alexandra alexandre alexei alexis alfie alfred ali alice alicia alina alisha alison alistair aliya allan allie allison alma alok amal amanda amara amber amelia amina amir amit amol amos amy ana anastasia anders andre andrea andreas andrew andy aneesh angela angelica angelina angus anil anita ann anna annabel annabelle anne annette annie anoushka anthony antoine anton antonia antonio anya april arabella archie ari ariana arjun arlo armando arnold aroon arthur arun arundhati asha ashley ashok astrid athena aubrey audrey august augustus aurora austin ava avery axel ayesha ayo
barbara barnaby barney barry bart bas basil beatrice beatriz beeban bella ben benedict benjamin bernadette bernard bernd bernie beth bethany betty bettany beverley bharti bianca bill billie billy blake bo bob bobby boris brad bradley brandon brenda brendan brett brian bridget brigid brooke bruce bruno bryan bryony
caitlin caleb callum calum cameron camilla candice cara carl carla carlos carmen carol carole caroline carolyn carrie casey caspar cassandra catherine cathy cecilia cecily cedric celeste celia chandra charles charlie charlotte chelsea cher cheryl chi chiara chidi chimamanda chinua chloe chris chrissie christian christina christine christopher chuck ciara cillian claire clara clare clarissa claude claudia clive cole colin colm connie connor conrad constance cora corinne cormac craig cressida cristina cynthia
dafydd daisy dale damian damien dan dana daniel daniela danielle danny daphne dara darcy darian darius darren daryl dave david davina dawn dean debbie deborah declan dee deepa deirdre delia denis denise dennis derek dev devi diana diane dianne dido diego dimitri dina dino dipesh dmitri dominic dominique don donald donna dora doreen doris dorje dorothy doug douglas dua duncan dylan
ed eddie edgar edith edmund edna eduardo edward edwin eileen elaine eleanor elena eli elif elijah elinor eliot eliza elizabeth ella ellen ellie elliot elliott eloise elsa elspeth emeka emil emile emilia emilio emily emma emmanuel enrico enzo erica eric erik erin ernest esme esther ethan etienne eugene eva evan eve evelyn ewan
fabian faisal farah fatima fay faye federico felicity felix fergal fergus fern fernando fiona flora florence fran frances francesca francis francisco frank frankie franz fred freddie frederick freya frieda
gabriel gabriela gabrielle gail gareth garry gary gavin gemma genevieve geoff geoffrey george georgia georgina gerald geraldine gerard gerd gideon gil gilbert gillian gina giovanni giulia giulio gloria gordon grace graham grant greg gregor gregory greta guy gwen gwendolyn
hadley hailey hal haley hamid hamish hana hannah hans harold harriet harrison harry harvey hassan hazel heather hector heidi helen helena helene henrietta henry herbert hilary hilda hiroshi holly honor hope horace howard hugh hugo humphrey humza husam hussain
iain ian ibrahim ichiro ida ifeoma igor imogen imran ines inga ingrid ira irene iris irving isaac isabel isabella isabelle isaiah isla ismail ivan ivy
jack jackie jackson jacob jacqueline jade jake james jamie jan jane janet janice jared jasmine jason jasper javier jay jean jeanette jeff jeffrey jelena jemima jen jenna jennifer jenny jeremy jerome jerry jess jesse jessica jill jim jimmy jo joan joanna joanne jocelyn jodie joe joel joey johan johann johanna john johnny jon jonah jonathan jordan jorge jose josef joseph josephine josh joshua joy joyce juan judith judy jules julia julian julie juliet julius june justin
kai kamala kara karen karim karin karl kat kate katharine katherine kathleen kathryn kathy katie katrina katy katya kay kayla keir keith kelly kelvin ken kenneth kenny kerry kevin khadija kieran kim kimberly kirsty kit kofi kristen kristin kurt kwame kyle
lachlan lana lance lani lara larry laura lauren laurence lawrence layla leah lee leila lena leo leon leonard leonie leslie lesley lewis liam lila lily lina linda lindsay lindsey linus lionel lisa liz liza lizzie lola lorna lorraine lottie louis louisa louise lucas lucia lucian lucy luis luke luther lydia lyn lynda lynn lynne lyse
mabel madeleine madeline madison mae maggi maggie magnus mahmoud maisie malcolm malik mandy manuel mara marc marcel marcus margaret margot maria marian mariana marie marina mario marion marisa marissa mark marta martha martin mary maryam mason matt matteo matthew maud maureen max maxine maya meera megan mehdi mei mel melanie melissa melvyn mercy meredith mia michael michaela michel michele michelle mick mike mikhail mila miles millie mina minh miranda miriam misha mohamed mohammad mohammed moira molly monica morag morgan moses muhammad muriel murray
nadia nadine nancy naomi natalie natasha nathan nathaniel navid neil nell nelson ness niall nicholas nick nicky nicola nicole nigel nikesh nikhil nikki nina noah noel nora norma norman nour nussaibah
olaf oliver olivia olga olia olly omar oona orla oscar otto owen
paddy padraig paige pamela pandora paola paolo paris pat patricia patrick paul paula pauline pearl pedro peggy penelope penny percy pete peter petra phil philip philippa phillip phoebe pia piers pippa polly poppy priya priyanka prudence
qasim quentin quinn
rachel rafael raj rajesh ralph ramon rana randall randy raphael raquel ravi ray raymond rebecca reggie reni rhiannon rhys ricardo richard rick ricky rita rob robert roberta roberto robin rocco rod rodney roger rohan roland rollo roman ronald ronan ronnie rory rosa rosalind rose rosemary rosie ross rowan roxanne ruby rudy rufus rupert russell ruth rutger ryan
sabrina sacha sadiq sally salman sam samantha sami samir samira samuel sandra sandy sanjay sara sarah sasha saskia scarlett scott sean sebastian selina seb serena sergei seth shahbaz shamus shane shania sharon shaun sheila shelley shira shirley sian sid sienna silvia simon simone siobhan sofia sonia sophia sophie stacey stanley stefan stefano stella stephanie stephen steve steven stewart stuart sue sunil susan susanna susie suzanne sven sylvia
tabitha tamara tammy tanya tara tariq ted teresa terence terry tess tessa thea theo theodore theresa thomas tilda tim timothy tina tobias toby tom tommy toni tony tracey tracy trevor tristan troy
ulrike uma una ursula
val valentina valerie vanessa vera veronica veronika vicky victor victoria vikki vikram vince vincent viola violet virginia vivian vivienne
walter wanda warren wendy wes wesley will william willie willow winifred winston
xavier xander
yasmin yasmine yolanda yoshi yuki yusuf yuval yvette yvonne
zach zachary zadie zain zainab zak zara zeinab zelda zoe zoltan
`;

export const GIVEN_NAMES: ReadonlySet<string> = new Set(NAMES.split(/\s+/).filter(Boolean));
