/**
 * E2 – Simple get (EPCIS alone). One test = one GET /events.
 *   QUERY = "byEpc"  : MATCH_anyEPC=["<identifier>"]
 *   QUERY = "latest" : perPage=10&orderBy=recordTime&orderDirection=DESC
 *   QUERY = "byType" : eventType=["ObjectEvent"]&perPage=10
 *
 * Identifiers for byEpc come from resources/ids.json (upload it next to the script, folder
 * "resources"); if the file is absent they are fetched from the repository's /epcs list.
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
class EpcisGet {

    static final String EPCIS_URL = "http://localhost:7080/epcis/v2"
    static final String QUERY = "byEpc"
    static final int PER_PAGE = 10
    // Optional: URL of an ids.json to download instead of uploading resources/ids.json,
    // e.g. "http://localhost:8000/aggregation-depth2/ids.json"
    static final String IDS_URL = ""

    public static GTest test
    public static HTTPRequest request
    public static Map<String, String> headers = [:]
    public static List ids = []
    static final Random rnd = new Random()

    @BeforeProcess
    public static void beforeProcess() {
        HTTPRequestControl.setConnectionTimeout(30000)
        test = new GTest(1, "GET /events " + QUERY)
        request = new HTTPRequest()
        headers = ["Accept": "application/json",
                   "GS1-EPCIS-Version": "2.0.0", "GS1-EPCIS-Max": "2.0.0", "GS1-EPCIS-Min": "2.0.0",
                   "GS1-CBV-Version": "2.0.0", "GS1-CBV-Max": "2.0.0", "GS1-CBV-Min": "2.0.0"]
        request.setHeaders(headers)
        if (QUERY == "byEpc") {
            ids = loadIds()
            grinder.logger.info("using {} identifiers", ids.size())
        }
    }

    /** resources/ids.json if uploaded, else IDS_URL if set, else the repository's own EPC list. */
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

    static Map<String, String> params() {
        switch (QUERY) {
            case "latest": return ["perPage": "$PER_PAGE".toString(), "orderBy": "recordTime", "orderDirection": "DESC"]
            case "byType": return ["eventType": '["ObjectEvent"]', "perPage": "$PER_PAGE".toString()]
            default:
                def id = ids[rnd.nextInt(ids.size())]
                return ["MATCH_anyEPC": '["' + id + '"]', "perPage": "$PER_PAGE".toString()]
        }
    }

    @Test
    public void test() {
        HTTPResponse response = request.GET(EPCIS_URL + "/events", params())
        assertThat(response.statusCode, is(200))
        def body = new JsonSlurper().parseText(response.getBodyText())
        def events = body?.epcisBody?.queryResults?.resultsBody?.eventList
        assertThat(events, notNullValue())
    }
}
