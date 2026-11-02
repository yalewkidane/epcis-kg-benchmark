/**
 * E5 – KG query (graph alone).
 * One test = one GET /traceability?id=<item>&direction=<DIRECTION>&depth=<DEPTH>.
 *
 * Identifiers come from resources/ids.json; if the file is absent they are fetched from the
 * graph's own object list (/traceability/objects).
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
class KgTrace {

    static final String KG_URL = "http://localhost:7087"
    static final String DIRECTION = "forward"
    static final int DEPTH = 10
    // Optional: URL of an ids.json to download instead of uploading resources/ids.json
    static final String IDS_URL = ""

    public static GTest test
    public static HTTPRequest request
    public static List ids = []
    static final Random rnd = new Random()
    static long totalEvents = 0, totalTests = 0

    @BeforeProcess
    public static void beforeProcess() {
        HTTPRequestControl.setConnectionTimeout(30000)
        test = new GTest(1, "KG trace")
        request = new HTTPRequest()
        request.setHeaders(["Accept": "application/json"])
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
        grinder.logger.warn("resources/ids.json not found, fetching identifiers from {}/traceability/objects", KG_URL)
        HTTPResponse r = request.GET(KG_URL + "/traceability/objects", ["limit": "500"])
        assertThat("GET /traceability/objects", r.statusCode, is(200))
        def items = new JsonSlurper().parseText(r.getBodyText())?.items ?: []
        def list = items.findAll { it.role != "aggregation" }.collect { it.objectID }
        if (list.isEmpty()) throw new IllegalStateException("No identifiers: upload resources/ids.json or load data into the graph first")
        return list
    }

    @BeforeThread
    public void beforeThread() {
        test.record(this, "test")
        grinder.statistics.delayReports = true
    }

    @Before
    public void before() {
        request.setHeaders(["Accept": "application/json"])
    }

    @Test
    public void test() {
        String id = ids[rnd.nextInt(ids.size())]
        HTTPResponse response = request.GET(KG_URL + "/traceability", ["id": id, "direction": DIRECTION, "depth": "$DEPTH".toString()])
        assertThat(response.statusCode, is(200))
        def body = new JsonSlurper().parseText(response.getBodyText())
        assertThat(body.summary, notNullValue())
        synchronized (KgTrace) {
            totalTests++; totalEvents += (body.summary.eventCount ?: 0)
            if (totalTests % 500 == 0) {
                grinder.logger.info("after {} tests: 1 request/test, {} events/test", totalTests, String.format("%.1f", totalEvents / (double) totalTests))
            }
        }
    }
}
