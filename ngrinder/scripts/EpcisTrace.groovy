/**
 * E3 – Traceability query with standard EPCIS queries (EPCIS alone).
 * One test = the breadth-first chain of GET /events needed to collect everything about an
 * item through its re-identifications (parentID, outputEPCList). The whole chain is one
 * recorded test, so TPS and mean test time are per chain. Requests and distinct events per
 * test are written to the agent log for the result table.
 *
 * Root identifiers come from resources/ids.json (controlled depth, see data/); if the file
 * is absent they are fetched from the repository's /epcs list (mixed depths).
 */
import static net.grinder.script.Grinder.grinder
import static org.junit.Assert.*
import static org.hamcrest.Matchers.*
import net.grinder.script.GTest
import net.grinder.scriptengine.groovy.junit.GrinderRunner
import net.grinder.scriptengine.groovy.junit.annotation.BeforeProcess
import net.grinder.scriptengine.groovy.junit.annotation.BeforeThread
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.ngrinder.http.HTTPRequest
import org.ngrinder.http.HTTPRequestControl
import org.ngrinder.http.HTTPResponse
import groovy.json.JsonSlurper

@RunWith(GrinderRunner)
class EpcisTrace {

    static final String EPCIS_URL = "http://localhost:7080/epcis/v2"
    static final List<String> MATCH_PARAMS = ["MATCH_anyEPC"]      // add "MATCH_inputEPC" for transformation chains
    static final int MAX_DEPTH = 6
    static final int PER_PAGE = 100
    // Optional: URL of an ids.json to download instead of uploading resources/ids.json
    static final String IDS_URL = ""

    public static GTest test
    public static HTTPRequest request
    public static Map<String, String> headers = [:]
    public static List ids = []
    static final Random rnd = new Random()
    static long totalRequests = 0, totalEvents = 0, totalTests = 0

    @BeforeProcess
    public static void beforeProcess() {
        HTTPRequestControl.setConnectionTimeout(30000)
        test = new GTest(1, "EPCIS trace chain")
        request = new HTTPRequest()
        headers = ["Accept": "application/json",
                   "GS1-EPCIS-Version": "2.0.0", "GS1-EPCIS-Max": "2.0.0", "GS1-EPCIS-Min": "2.0.0",
                   "GS1-CBV-Version": "2.0.0", "GS1-CBV-Max": "2.0.0", "GS1-CBV-Min": "2.0.0"]
        request.setHeaders(headers)
        ids = loadIds()
        grinder.logger.info("using {} identifiers", ids.size())
    }

    static List loadIds() {
        File f = new File("./resources/ids.json")
        if (f.exists()) return new JsonSlurper().parse(f)
        if (IDS_URL) {
            HTTPResponse r = request.GET(IDS_URL)
            assertThat("GET " + IDS_URL, r.statusCode, is(200))
            return new JsonSlurper().parseText(r.getBodyText())
        }
        grinder.logger.warn("resources/ids.json not found, fetching identifiers from {}/epcs", EPCIS_URL)
        HTTPResponse r = request.GET(EPCIS_URL + "/epcs", ["PerPage": "1000"])
        assertThat("GET /epcs", r.statusCode, is(200))
        def list = new JsonSlurper().parseText(r.getBodyText())?.member ?: []
        if (list.isEmpty()) throw new IllegalStateException("No identifiers: upload resources/ids.json or capture data first")
        return list
    }

    @BeforeThread
    public void beforeThread() {
        test.record(this, "test")
        grinder.statistics.delayReports = true
    }

    @Before
    public void before() {
        request.setHeaders(headers)
    }

    static List newIdentifiers(Map ev) {
        def out = []
        if (ev.parentID) out << ev.parentID
        if (ev.outputEPCList instanceof List) out.addAll(ev.outputEPCList)
        if (ev.outputQuantityList instanceof List) out.addAll(ev.outputQuantityList.collect { it.epcClass })
        return out.findAll { it }
    }

    @Test
    public void test() {
        String root = ids[rnd.nextInt(ids.size())]
        Set visited = [root] as Set
        Set events = [] as Set
        List frontier = [root]
        int hops = 0, requests = 0
        def slurper = new JsonSlurper()

        while (frontier && hops <= MAX_DEPTH) {
            List next = []
            for (String id : frontier) {
                for (String param : MATCH_PARAMS) {
                    HTTPResponse response = request.GET(EPCIS_URL + "/events", [(param): '["' + id + '"]', "perPage": "$PER_PAGE".toString()])
                    requests++
                    assertThat("hop " + hops + " " + param, response.statusCode, is(200))
                    def list = slurper.parseText(response.getBodyText())?.epcisBody?.queryResults?.resultsBody?.eventList ?: []
                    for (Map ev : list) {
                        events << (ev.eventID ?: ev.toString())
                        for (String nid : newIdentifiers(ev)) {
                            if (visited.add(nid)) next << nid
                        }
                    }
                }
            }
            frontier = next
            hops++
        }
        synchronized (EpcisTrace) {
            totalTests++; totalRequests += requests; totalEvents += events.size()
            if (totalTests % 500 == 0) {
                grinder.logger.info("after {} tests: {} requests/test, {} events/test", totalTests,
                        String.format("%.2f", totalRequests / (double) totalTests), String.format("%.1f", totalEvents / (double) totalTests))
            }
        }
    }
}
